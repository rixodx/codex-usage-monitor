Option Explicit
Dim shell, fso, folder, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
If fso.FileExists(folder & "\codex-usage-monitor.exe") Then
    command = Chr(34) & folder & "\codex-usage-monitor.exe" & Chr(34)
    shell.Run command, 1, False
Else
    command = "powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File " & Chr(34) & folder & "\Widget.ps1" & Chr(34)
    shell.Run command, 1, False
End If
