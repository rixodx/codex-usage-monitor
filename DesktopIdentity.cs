using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WidgetDesktopIdentity
{
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")]
    private static extern IntPtr GetThreadDesktop(uint threadId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetUserObjectInformation(IntPtr handle, int index,
        StringBuilder output, int length, out int needed);

    public static string GetName()
    {
        StringBuilder result = new StringBuilder(512);
        int needed;
        if (!GetUserObjectInformation(GetThreadDesktop(GetCurrentThreadId()), 2, result, 1024, out needed))
            throw new InvalidOperationException("无法识别当前 Windows 桌面：" + Marshal.GetLastWin32Error());
        return result.ToString();
    }

    public static string MutexSuffix(string folder, string desktop)
    {
        using (var hash = System.Security.Cryptography.SHA256.Create())
        {
            byte[] identity = Encoding.UTF8.GetBytes(folder.TrimEnd('\\').ToLowerInvariant() + "|" + desktop);
            return BitConverter.ToString(hash.ComputeHash(identity)).Replace("-", "").Substring(0, 16);
        }
    }
}
