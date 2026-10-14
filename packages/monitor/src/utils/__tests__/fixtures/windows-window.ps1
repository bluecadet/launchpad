$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class WindowFixture
{
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr window);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr window);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    private static int stopping;
    public static bool Stopping { get { return Volatile.Read(ref stopping) != 0; } }

    public static void WatchInput()
    {
        var reader = new Thread(() => {
            try { while (Console.In.Read() != -1) { } }
            finally { Interlocked.Exchange(ref stopping, 1); }
        });
        reader.IsBackground = true;
        reader.Start();
    }
}
'@

# Do not leave an error dialog blocking the message loop on a fixture failure.
[System.Windows.Forms.Application]::SetUnhandledExceptionMode('ThrowException')
$form = New-Object System.Windows.Forms.Form
$timer = New-Object System.Windows.Forms.Timer
try {
    if ([string]::IsNullOrEmpty($env:LAUNCHPAD_WINDOW_FIXTURE_TITLE)) {
        throw 'Missing fixture title'
    }
    $form.Text = $env:LAUNCHPAD_WINDOW_FIXTURE_TITLE
    $form.Width = 320
    $form.Height = 160
    $form.StartPosition = 'CenterScreen'
    $form.WindowState = 'Normal'
    $script:windowHandle = [IntPtr]::Zero
    $script:windowId = ''
    $watchdog = [System.Diagnostics.Stopwatch]::StartNew()

    function Send-WindowState {
        [uint32]$ownerProcessId = 0
        $threadId = [WindowFixture]::GetWindowThreadProcessId($script:windowHandle, [ref]$ownerProcessId)
        if ($threadId -eq 0 -or $ownerProcessId -ne $PID) {
            throw 'Fixture window identity changed'
        }
        $state = @{
            id = $script:windowId
            processId = $ownerProcessId
            visible = [WindowFixture]::IsWindowVisible($script:windowHandle)
            minimized = [WindowFixture]::IsIconic($script:windowHandle)
        }
        [Console]::Out.WriteLine(($state | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
    }

    $form.Add_Shown({
        # Capture once: never turn a recreated Form handle into a new identity.
        $script:windowHandle = $form.Handle
        $script:windowId = $script:windowHandle.ToInt64().ToString([Globalization.CultureInfo]::InvariantCulture)
        Send-WindowState
        $timer.Start()
    })
    $timer.Interval = 100
    $timer.Add_Tick({
        # WinForms timers keep running when the Form is hidden or minimized.
        if ([WindowFixture]::Stopping -or $watchdog.Elapsed.TotalSeconds -ge 120) {
            $form.Close()
            return
        }
        Send-WindowState
    })
    [WindowFixture]::WatchInput()
    [System.Windows.Forms.Application]::Run($form)
} catch {
    [Console]::Error.WriteLine($_.ToString())
    exit 1
} finally {
    $timer.Stop()
    $timer.Dispose()
    $form.Dispose()
}
