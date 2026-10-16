using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

internal static class Launcher
{
    [STAThread]
    private static void Main()
    {
        string folder = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(folder, "Widget.ps1");
        try
        {
            File.AppendAllText(Path.Combine(folder, "launcher.log"),
                DateTime.Now.ToString("s") + " desktop=" + WidgetDesktopIdentity.GetName() + Environment.NewLine);
            if (!File.Exists(script))
                throw new FileNotFoundException("请先解压整个文件夹，再运行 CodexUsageWidget.exe。", script);
            string powershell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                @"WindowsPowerShell\v1.0\powershell.exe");
            ProcessStartInfo start = new ProcessStartInfo();
            start.FileName = powershell;
            start.Arguments = "-NoProfile -STA -ExecutionPolicy Bypass -File \"" + script + "\"";
            start.WorkingDirectory = folder;
            start.UseShellExecute = false;
            start.CreateNoWindow = true;
            Process child = Process.Start(start);
            File.AppendAllText(Path.Combine(folder, "launcher.log"), "pid=" + child.Id + Environment.NewLine);
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "Codex Usage 启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
