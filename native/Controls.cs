using System;
using System.Collections.Generic;
using System.Globalization;
using System.Diagnostics;
using System.Threading;
using System.Management;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

// A local stdin/stdout protocol. The helper never adjusts anything at startup.
// Writes require an explicit --allow-write argument; all other launches are read-only.
internal static class Program
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 16384 };
    private static Dictionary<string, object> brightnessCache;
    private static DateTime brightnessReadAt = DateTime.MinValue;

    [MTAThread]
    private static void Main(string[] args)
    {
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        bool readOnly = args.Length != 1 || args[0] != "--allow-write";
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            int id = 0;
            try
            {
                if (line.Length > 8192) throw new ArgumentException("请求过长");
                var request = Json.Deserialize<Dictionary<string, object>>(line);
                if (request == null || !request.ContainsKey("id") || !(request["id"] is int))
                    throw new ArgumentException("请求编号无效");
                id = (int)request["id"];
                object operation;
                if (!request.TryGetValue("op", out operation) || !(operation is string))
                    throw new ArgumentException("请求操作无效");
                string op = (string)operation;
                if (op != "get")
                {
                    // This check deliberately precedes all device access for write requests.
                    if (readOnly) throw new InvalidOperationException("READ_ONLY: 此进程禁止修改系统设置");
                    object value;
                    if (!request.TryGetValue("value", out value)) throw new ArgumentException("缺少设置值");
                    if (op == "setVolume")
                    {
                        double percent = ValidatePercent(value);
                        using (var audio = new AudioEndpoint()) { ValidateTarget(request, audio); audio.SetVolume((float)(percent / 100.0)); }
                    }
                    else if (op == "setMuted")
                    {
                        if (!(value is bool)) throw new ArgumentException("静音值必须为布尔值");
                        using (var audio = new AudioEndpoint()) { ValidateTarget(request, audio); audio.SetMuted((bool)value); }
                    }
                    else if (op == "setBrightness") SetBrightness(ValidatePercent(value));
                    else throw new ArgumentException("未知操作");
                }
                Write(new { id = id, ok = true, state = ReadState(op == "setBrightness") });
            }
            catch (Exception error)
            {
                string message = error is ArgumentException || error is InvalidOperationException
                    ? error.Message : "Windows 无法完成此次系统控制操作";
                if (error is DeviceChangedException) Write(new { id = id, ok = false, error = message, state = ReadState(false) });
                else Write(new { id = id, ok = false, error = message });
            }
        }
    }

    private static void ValidateTarget(Dictionary<string, object> request, AudioEndpoint audio)
    {
        object requested;
        if (!request.TryGetValue("deviceId", out requested) || !(requested is string) ||
            String.IsNullOrWhiteSpace((string)requested) ||
            !String.Equals((string)requested, audio.DeviceId, StringComparison.Ordinal))
            throw new DeviceChangedException("音频输出设备已变化，请重新调整");
    }

    private static double ValidatePercent(object value)
    {
        if (!(value is int) && !(value is long) && !(value is decimal) && !(value is double))
            throw new ArgumentException("数值必须是 0 到 100 的数字");
        double number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
        if (Double.IsNaN(number) || Double.IsInfinity(number) || number < 0 || number > 100)
            throw new ArgumentException("数值必须是 0 到 100 的数字");
        return number;
    }

    private static void Write(object result)
    {
        Console.WriteLine(Json.Serialize(result));
        Console.Out.Flush();
    }

    private static object ReadState(bool refreshBrightness)
    {
        object audioState;
        try
        {
            // Resolve the default multimedia output on each request, including after device changes.
            using (var audio = new AudioEndpoint())
                audioState = new { available = true, deviceId = audio.DeviceId, volume = Math.Round(audio.Volume * 100.0, 1), muted = audio.Muted };
        }
        catch { audioState = new { available = false, deviceId = (string)null, volume = (double?)null, muted = (bool?)null, error = "未检测到可控制的音频输出设备" }; }
        if (refreshBrightness || brightnessCache == null || (DateTime.UtcNow - brightnessReadAt).TotalMilliseconds > 1500)
        {
            brightnessCache = ReadBrightness();
            brightnessReadAt = DateTime.UtcNow;
        }
        return new { audio = audioState, brightness = brightnessCache };
    }

    private static ManagementObjectSearcher Search(string query, int timeoutMilliseconds = 2000)
    {
        return new ManagementObjectSearcher(new ManagementScope(@"\\.\root\wmi"), new ObjectQuery(query),
            new EnumerationOptions { Timeout = TimeSpan.FromMilliseconds(timeoutMilliseconds), ReturnImmediately = false });
    }

    private static Dictionary<string, object> ReadBrightness()
    {
        try
        {
            using (var searcher = Search("SELECT * FROM WmiMonitorBrightness WHERE Active = TRUE"))
            using (var collection = searcher.Get())
            {
                ManagementObject selected = null;
                foreach (ManagementObject monitor in collection)
                {
                    if (selected != null)
                    {
                        monitor.Dispose(); selected.Dispose();
                        return UnavailableBrightness("检测到多个亮度接口，暂不自动选择屏幕");
                    }
                    selected = monitor;
                }
                if (selected != null)
                {
                    using (selected)
                        return new Dictionary<string, object> { { "available", true }, { "value", Convert.ToInt32(selected["CurrentBrightness"]) } };
                }
            }
        }
        catch { return UnavailableBrightness("当前屏幕未提供 Windows 内屏亮度接口"); }
        return UnavailableBrightness("当前屏幕未提供 Windows 内屏亮度接口");
    }

    private static Dictionary<string, object> UnavailableBrightness(string error)
    {
        return new Dictionary<string, object> { { "available", false }, { "value", null }, { "error", error } };
    }

    private static int? ReadBrightnessValue(string instance, int timeoutMilliseconds)
    {
        using (var searcher = Search("SELECT * FROM WmiMonitorBrightness WHERE Active = TRUE", timeoutMilliseconds))
        using (var collection = searcher.Get())
        {
            foreach (ManagementObject monitor in collection)
            {
                using (monitor)
                {
                    if (String.Equals(instance, Convert.ToString(monitor["InstanceName"], CultureInfo.InvariantCulture), StringComparison.OrdinalIgnoreCase))
                    {
                        object value = monitor["CurrentBrightness"];
                        if (value == null) return null;
                        int observed = Convert.ToInt32(value, CultureInfo.InvariantCulture);
                        return observed >= 0 && observed <= 100 ? (int?)observed : null;
                    }
                }
            }
        }
        return null;
    }

    private static void SetBrightness(double value)
    {
        string instance = null;
        byte[] levels = null;
        using (var searcher = Search("SELECT * FROM WmiMonitorBrightness WHERE Active = TRUE"))
        using (var collection = searcher.Get())
        {
            foreach (ManagementObject monitor in collection)
            {
                using (monitor)
                {
                    if (instance != null) throw new InvalidOperationException("检测到多个亮度接口，暂不自动选择屏幕");
                    instance = Convert.ToString(monitor["InstanceName"], CultureInfo.InvariantCulture);
                    levels = monitor["Level"] as byte[];
                }
            }
        }
        if (instance == null) throw new InvalidOperationException("当前屏幕不支持内屏亮度调节");
        byte target = (byte)Math.Round(value);
        if (levels != null && levels.Length > 0)
        {
            target = levels[0];
            foreach (byte level in levels)
                if (Math.Abs(level - value) < Math.Abs(target - value)) target = level;
        }
        using (var searcher = Search("SELECT * FROM WmiMonitorBrightnessMethods WHERE Active = TRUE"))
        using (var collection = searcher.Get())
        {
            foreach (ManagementObject monitor in collection)
            {
                using (monitor)
                {
                    if (!String.Equals(instance, Convert.ToString(monitor["InstanceName"], CultureInfo.InvariantCulture), StringComparison.OrdinalIgnoreCase)) continue;
                    using (var arguments = monitor.GetMethodParameters("WmiSetBrightness"))
                    {
                        arguments["Timeout"] = (uint)0;
                        arguments["Brightness"] = target;
                        object returnValue = null;
                        using (var result = monitor.InvokeMethod("WmiSetBrightness", arguments, new InvokeMethodOptions { Timeout = TimeSpan.FromSeconds(2) }))
                        {
                            // Some Windows providers expose no output parameters and return null.
                            if (result != null)
                                foreach (PropertyData property in result.Properties)
                                    if (String.Equals(property.Name, "ReturnValue", StringComparison.OrdinalIgnoreCase))
                                        returnValue = property.Value;
                        }
                        brightnessCache = null;
                        // The same display's reported brightness is authoritative, even when
                        // a provider's undocumented return type differs from the SDK sample.
                        BrightnessVerification.Confirm(target, returnValue,
                            timeout => ReadBrightnessValue(instance, timeout), Thread.Sleep);
                    }
                    brightnessCache = null;
                    return;
                }
            }
        }
        throw new InvalidOperationException("当前屏幕不支持内屏亮度调节");
    }
}

// Pure verification policy, separated so tests never need to invoke a real setter.
internal static class BrightnessVerification
{
    internal static bool IsExplicitFailure(object value)
    {
        if (value == null) return false;
        if (value is bool) return !(bool)value;
        if (value is byte || value is sbyte || value is short || value is ushort ||
            value is int || value is uint || value is long || value is ulong ||
            value is float || value is double || value is decimal)
            return Convert.ToDouble(value, CultureInfo.InvariantCulture) != 0;
        return false;
    }

    internal static void Confirm(byte target, object returnValue, Func<int, int?> read, Action<int> wait)
    {
        var clock = Stopwatch.StartNew();
        foreach (int delay in new int[] { 0, 50, 100, 200 })
        {
            int remaining = 900 - (int)clock.ElapsedMilliseconds;
            if (remaining <= delay) break;
            if (delay > 0) wait(delay);
            remaining = 900 - (int)clock.ElapsedMilliseconds;
            if (remaining <= 0) break;
            int? observed = null;
            try { observed = read(Math.Min(remaining, 200)); }
            catch { /* A brief driver read failure can settle on the next bounded read. */ }
            if (observed.HasValue && observed.Value == target) return;
        }
        if (IsExplicitFailure(returnValue))
            throw new InvalidOperationException("屏幕未接受亮度设置，当前亮度未达到目标");
        throw new InvalidOperationException("亮度未生效，请重试");
    }
}

internal sealed class DeviceChangedException : InvalidOperationException
{
    internal DeviceChangedException(string message) : base(message) { }
}

internal sealed class AudioEndpoint : IDisposable
{
    private IMMDeviceEnumerator enumerator;
    private IMMDevice device;
    private IAudioEndpointVolume endpoint;
    internal string DeviceId { get; private set; }
    internal AudioEndpoint()
    {
        try
        {
            enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out device));
            string rawId;
            Marshal.ThrowExceptionForHR(device.GetId(out rawId));
            using (var hash = SHA256.Create())
                DeviceId = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(rawId))).Replace("-", "").ToLowerInvariant();
            Guid iid = typeof(IAudioEndpointVolume).GUID;
            object volume;
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out volume));
            endpoint = (IAudioEndpointVolume)volume;
        }
        catch { Dispose(); throw; }
    }
    internal float Volume { get { float value; Marshal.ThrowExceptionForHR(endpoint.GetMasterVolumeLevelScalar(out value)); return value; } }
    internal bool Muted { get { bool value; Marshal.ThrowExceptionForHR(endpoint.GetMute(out value)); return value; } }
    internal void SetVolume(float value) { Guid context = Guid.Empty; Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar(value, ref context)); }
    internal void SetMuted(bool value) { Guid context = Guid.Empty; Marshal.ThrowExceptionForHR(endpoint.SetMute(value, ref context)); }
    public void Dispose()
    {
        if (endpoint != null) { Marshal.ReleaseComObject(endpoint); endpoint = null; }
        if (device != null) { Marshal.ReleaseComObject(device); device = null; }
        if (enumerator != null) { Marshal.ReleaseComObject(enumerator); enumerator = null; }
    }
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumerator { }
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, uint stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr client);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr client);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    [PreserveSig] int Activate(ref Guid iid, uint clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object value);
    [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out uint state);
}
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume
{
    [PreserveSig] int RegisterControlChangeNotify(IntPtr client);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr client);
    [PreserveSig] int GetChannelCount(out uint count);
    [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid context);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
    [PreserveSig] int GetMasterVolumeLevel(out float level);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
    [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
}