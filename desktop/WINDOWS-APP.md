# AirLab for Windows

AirLab runs in a Windows desktop window using Microsoft Edge WebView2. The Windows build is x64 and requires .NET Framework 4.8 and the WebView2 Runtime.

## Build locally

1. Obtain the [Microsoft.Web.WebView2 SDK version 1.0.4314.35](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4314.35). Extract the NuGet package into `work/webview2-sdk` so that `lib/net462`, `runtimes/win-x64/native`, and `LICENSE.txt` are directly under that folder.
2. From the project folder in PowerShell, run:

   ```powershell
   .\desktop\build.ps1
   ```

3. Open `outputs/AirLab-Windows/AirLab.exe`. Keep its companion files together.

The desktop package includes the web assets, so you can run it without Node.js. The build compiles an unsigned development executable. The browser version is available through `node serve.mjs` when Windows security policies require signed apps.

## Camera and updates

Select **Enable hand tracking**, allow the camera prompt, and choose your computer webcam under **Camera source**. Video is processed locally.

The build links the desktop app to the source folder used to compile it. Changes to `dist/` and version metadata enable **Apply update** in the app. Applying an update reloads the current session. Rebuild while AirLab is closed if you change the Windows wrapper. If the source folder is unavailable, AirLab uses its bundled assets.

The app keeps its WebView2 profile in a local folder configured at build time. The build does not install a Windows service or startup task.
