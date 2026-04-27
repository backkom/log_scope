using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

/// <summary>
/// Unity-friendly LogScope sender.
///
/// Usage:
///   LogSender.Instance.Configure("255.255.255.0", "Unity-");
///   LogSender.Instance.SendLog("hello from Unity");
///
/// Protocol:
///   TCP frame = uint32 big-endian payload length + UTF-8 JSON payload
///   UDP discovery = logscope-discovery-v1 JSON broadcast to port 9876 every 3s
/// </summary>
/// 

namespace LogScope
{

    public sealed class LogSender : IDisposable
    {
        private static readonly LogSender SharedInstance = new LogSender();

        public static LogSender Instance
        {
            get { return SharedInstance; }
        }

        private const int DefaultTcpPort = 8765;
        private const int DiscoveryPort = 9876;
        private const int DiscoveryIntervalMs = 3000;
        private const int MaxPortAttempts = 4;

        private readonly object _sync = new object();
        private readonly List<TcpClient> _clients = new List<TcpClient>();

        private TcpListener _listener;
        private Thread _acceptThread;
        private Thread _discoveryThread;
        private volatile bool _running;
        private volatile int _generation;

        private int _tcpPort = DefaultTcpPort;
        private string _broadcastAddress = "255.255.255.255";
        private string _localAddress = "127.0.0.1";
        private string _displayHostname = Environment.MachineName;

        private LogSender()
        {
        }

        /// <summary>
        /// Starts or restarts the LogScope TCP sender and UDP discovery broadcaster.
        ///
        /// subnetmask accepts either a subnet mask such as "255.255.255.0" or a
        /// broadcast address such as "192.168.1.255". Empty/null falls back to
        /// 255.255.255.255.
        ///
        /// name is prepended to the machine hostname in discovery packets. If a
        /// separator is desired, include it in name, for example "Unity-".
        /// </summary>
        public void Configure(string subnetmask, string name)
        {
            Configure(subnetmask, name, DefaultTcpPort);
        }

        public void Configure(string subnetmask, string name, int tcpPort)
        {
            Stop();

            var requestedPort = tcpPort > 0 && tcpPort <= 65535 ? tcpPort : DefaultTcpPort;
            _localAddress = GetLocalIPv4Address();
            _broadcastAddress = ResolveBroadcastAddress(_localAddress, subnetmask);
            _displayHostname = (name ?? string.Empty) + Environment.MachineName;

            _generation++;
            var generation = _generation;
            _running = true;
            _listener = StartListenerWithFallback(requestedPort);
            var localEndpoint = _listener.LocalEndpoint as IPEndPoint;
            _tcpPort = localEndpoint != null ? localEndpoint.Port : requestedPort;
            var listener = _listener;
            var broadcastAddress = _broadcastAddress;
            var localAddress = _localAddress;
            var displayHostname = _displayHostname;

            _acceptThread = new Thread(() => AcceptLoop(listener, generation))
            {
                IsBackground = true,
                Name = "LogScope TCP Accept"
            };
            _acceptThread.Start();

            _discoveryThread = new Thread(() => DiscoveryLoop(broadcastAddress, localAddress, displayHostname, _tcpPort, generation))
            {
                IsBackground = true,
                Name = "LogScope UDP Discovery"
            };
            _discoveryThread.Start();
        }

        public void SendLog(string log)
        {
            if (!_running)
            {
                Configure(null, null, DefaultTcpPort);
            }

            var text = log ?? string.Empty;
            var frame = PackLogBatchFrame(text);

            lock (_sync)
            {
                for (var i = _clients.Count - 1; i >= 0; i--)
                {
                    var client = _clients[i];
                    try
                    {
                        if (!client.Connected)
                        {
                            RemoveClientAt(i);
                            continue;
                        }

                        var stream = client.GetStream();
                        stream.Write(frame, 0, frame.Length);
                        stream.Flush();
                    }
                    catch
                    {
                        RemoveClientAt(i);
                    }
                }
            }
        }

        public void Stop()
        {
            _running = false;
            _generation++;

            try
            {
                if (_listener != null)
                {
                    _listener.Stop();
                }
            }
            catch
            {
            }
            _listener = null;

            lock (_sync)
            {
                for (var i = _clients.Count - 1; i >= 0; i--)
                {
                    RemoveClientAt(i);
                }
            }
        }

        public void Dispose()
        {
            Stop();
        }

        private void AcceptLoop(TcpListener listener, int generation)
        {
            while (_running && generation == _generation)
            {
                try
                {
                    var client = listener.AcceptTcpClient();
                    client.NoDelay = true;
                    lock (_sync)
                    {
                        _clients.Add(client);
                    }
                }
                catch
                {
                    if (_running && generation == _generation)
                    {
                        Thread.Sleep(200);
                    }
                }
            }
        }

        private void DiscoveryLoop(string broadcastAddress, string localAddress, string displayHostname, int tcpPort, int generation)
        {
            using (var udp = new UdpClient())
            {
                udp.EnableBroadcast = true;

                var endpoint = new IPEndPoint(IPAddress.Parse(broadcastAddress), DiscoveryPort);
                while (_running && generation == _generation)
                {
                    try
                    {
                        var json = "{\"protocol\":\"logscope-discovery-v1\",\"host\":\""
                            + JsonEscape(localAddress)
                            + "\",\"port\":"
                            + tcpPort
                            + ",\"hostname\":\""
                            + JsonEscape(displayHostname)
                            + "\"}";
                        var payload = Encoding.UTF8.GetBytes(json);
                        udp.Send(payload, payload.Length, endpoint);
                    }
                    catch
                    {
                    }

                    Thread.Sleep(DiscoveryIntervalMs);
                }
            }
        }

        private static byte[] PackLogBatchFrame(string text)
        {
            var json = "{\"version\":1,\"recordType\":\"log.batch\",\"records\":[{\"text\":\""
                + JsonEscape(text)
                + "\"}]}";
            var payload = Encoding.UTF8.GetBytes(json);
            var frame = new byte[4 + payload.Length];

            frame[0] = (byte)((payload.Length >> 24) & 0xff);
            frame[1] = (byte)((payload.Length >> 16) & 0xff);
            frame[2] = (byte)((payload.Length >> 8) & 0xff);
            frame[3] = (byte)(payload.Length & 0xff);
            Buffer.BlockCopy(payload, 0, frame, 4, payload.Length);

            return frame;
        }

        private static string JsonEscape(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            var builder = new StringBuilder(value.Length + 16);
            foreach (var ch in value)
            {
                switch (ch)
                {
                    case '\\':
                        builder.Append("\\\\");
                        break;
                    case '"':
                        builder.Append("\\\"");
                        break;
                    case '\b':
                        builder.Append("\\b");
                        break;
                    case '\f':
                        builder.Append("\\f");
                        break;
                    case '\n':
                        builder.Append("\\n");
                        break;
                    case '\r':
                        builder.Append("\\r");
                        break;
                    case '\t':
                        builder.Append("\\t");
                        break;
                    default:
                        if (ch < 0x20)
                        {
                            builder.Append("\\u");
                            builder.Append(((int)ch).ToString("x4"));
                        }
                        else
                        {
                            builder.Append(ch);
                        }
                        break;
                }
            }

            return builder.ToString();
        }

        private static TcpListener StartListenerWithFallback(int requestedPort)
        {
            var startPort = requestedPort > 0 && requestedPort <= 65535 ? requestedPort : DefaultTcpPort;
            var endPort = Math.Min(65535, startPort + MaxPortAttempts - 1);
            SocketException lastError = null;

            for (var currentPort = startPort; currentPort <= endPort; currentPort++)
            {
                Console.WriteLine("[LogScope] trying TCP port " + currentPort);
                try
                {
                    var listener = new TcpListener(IPAddress.Any, currentPort);
                    listener.Start();
                    Console.WriteLine("[LogScope] listening on TCP port " + currentPort);
                    return listener;
                }
                catch (SocketException ex)
                {
                    lastError = ex;
                    Console.WriteLine("[LogScope] failed to bind TCP port " + currentPort + ": " + ex.Message);
                }
            }

            Console.WriteLine("[LogScope] exhausted TCP port attempts from " + startPort + " to " + endPort);
            throw lastError ?? new SocketException((int)SocketError.AddressAlreadyInUse);
        }

        private void RemoveClientAt(int index)
        {
            try
            {
                _clients[index].Close();
            }
            catch
            {
            }

            _clients.RemoveAt(index);
        }

        private static string GetLocalIPv4Address()
        {
            try
            {
                using (var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, 0))
                {
                    socket.Connect("8.8.8.8", 80);
                    var endpoint = socket.LocalEndPoint as IPEndPoint;
                    if (endpoint != null)
                    {
                        return endpoint.Address.ToString();
                    }
                }
            }
            catch
            {
            }

            return "127.0.0.1";
        }

        private static string ResolveBroadcastAddress(string localAddress, string subnetmask)
        {
            if (string.IsNullOrWhiteSpace(subnetmask))
            {
                return "255.255.255.255";
            }

            IPAddress parsed;
            if (!IPAddress.TryParse(subnetmask.Trim(), out parsed))
            {
                return "255.255.255.255";
            }

            var bytes = parsed.GetAddressBytes();
            if (bytes.Length != 4)
            {
                return "255.255.255.255";
            }

            if (parsed.ToString() == "255.255.255.255")
            {
                return "255.255.255.255";
            }

            if (!LooksLikeSubnetMask(bytes))
            {
                return parsed.ToString();
            }

            IPAddress localIp;
            if (!IPAddress.TryParse(localAddress, out localIp))
            {
                return "255.255.255.255";
            }

            var ipBytes = localIp.GetAddressBytes();
            if (ipBytes.Length != 4)
            {
                return "255.255.255.255";
            }

            var broadcast = new byte[4];
            for (var i = 0; i < 4; i++)
            {
                broadcast[i] = (byte)(ipBytes[i] | ~bytes[i]);
            }

            return new IPAddress(broadcast).ToString();
        }

        private static bool LooksLikeSubnetMask(byte[] bytes)
        {
            var value = ((uint)bytes[0] << 24)
                | ((uint)bytes[1] << 16)
                | ((uint)bytes[2] << 8)
                | bytes[3];

            var seenZero = false;
            for (var bit = 31; bit >= 0; bit--)
            {
                var isOne = ((value >> bit) & 1) == 1;
                if (!isOne)
                {
                    seenZero = true;
                }
                else if (seenZero)
                {
                    return false;
                }
            }

            return true;
        }
    }

}
