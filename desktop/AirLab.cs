using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading;
using System.Threading.Tasks;
using System.Drawing;
using System.Windows.Forms;
using System.Diagnostics;
using System.Reflection;
using System.Web.Script.Serialization;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("AirLab")]
[assembly: AssemblyProduct("AirLab")]
[assembly: AssemblyDescription("Hand-controlled physics laboratory for Windows")]
[assembly: AssemblyVersion("1.0.0.0")]

public sealed class DesktopConfig {
    public string sourceRoot { get; set; }
    public string profileRoot { get; set; }
}

public static class Program {
    public static readonly string AppDirectory = AppDomain.CurrentDomain.BaseDirectory;
    public static DesktopConfig Config;
    public static string AssetRoot;
    public static string SourceRoot;
    public static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    [STAThread]
    public static int Main(string[] args) {
        try {
            var configPath = Path.Combine(AppDirectory, "airlab-settings.json");
            Config = File.Exists(configPath) ? Json.Deserialize<DesktopConfig>(File.ReadAllText(configPath)) : new DesktopConfig();
            SourceRoot = !String.IsNullOrWhiteSpace(Config.sourceRoot) ? Path.GetFullPath(Config.sourceRoot) : "";
            AssetRoot = SourceRoot.Length > 0 && File.Exists(Path.Combine(SourceRoot,"dist","index.html")) ? Path.Combine(SourceRoot,"dist") : Path.Combine(AppDirectory,"wwwroot");
            if (!File.Exists(Path.Combine(AssetRoot,"index.html"))) throw new FileNotFoundException("AirLab files were not found. Keep the application folder together, or rebuild it from your AirLab project.");
            if (args.Contains("--self-test")) return SelfTest();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new AirLabWindow(args.Contains("--smoke-test")));
            return 0;
        } catch(Exception ex) {
            if(args.Contains("--self-test")) { File.WriteAllText(Path.Combine(AppDirectory,"self-test-error.txt"),ex.ToString());return 1; }
            MessageBox.Show("AirLab could not start.\n\n" + ex.Message,"AirLab",MessageBoxButtons.OK,MessageBoxIcon.Error);
            return 1;
        }
    }
    private static int SelfTest() {
        string runtime = CoreWebView2Environment.GetAvailableBrowserVersionString();
        using(var server = new LocalAssetServer(AssetRoot)) {
            server.Start();
            using(var client = new WebClient()) {
                var html = client.DownloadString(server.Origin);
                if(!html.Contains("Physics at your")) throw new Exception("The local app entry page failed validation.");
                var module = client.DownloadString(server.Origin+"hand-control.mjs");
                if(!module.Contains("chooseCamera")) throw new Exception("The multi-hand camera controller is missing.");
                var wasm = client.DownloadData(server.Origin+"vendor/wasm/vision_wasm_internal.wasm");
                if(wasm.Length < 8 || wasm[0]!=0 || wasm[1]!=97 || wasm[2]!=115 || wasm[3]!=109) throw new Exception("The hand-tracking WASM is invalid.");
                bool blocked=false;
                try { client.DownloadData(server.Origin+"%2e%2e%2fREADME.md"); } catch(WebException ex) { var r=ex.Response as HttpWebResponse;blocked=r!=null&&(r.StatusCode==HttpStatusCode.Forbidden||r.StatusCode==HttpStatusCode.NotFound); }
                if(!blocked)throw new Exception("The asset server did not reject path traversal.");
                File.WriteAllText(Path.Combine(AppDirectory,"self-test.json"),Json.Serialize(new {success=true,runtime=runtime,assetRoot=AssetRoot,checks=new[]{"Windows runtime","local page","multi-hand module","WASM binary","path boundary"}}));
            }
        }
        return 0;
    }
}

public sealed class LocalAssetServer : IDisposable {
    private readonly string root;
    private TcpListener listener;
    private volatile bool stopped;
    public string Origin { get; private set; }
    public LocalAssetServer(string assetRoot) { root=Path.GetFullPath(assetRoot).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar; }
    public void Start(int preferredPort = 0) {
        listener=new TcpListener(IPAddress.Loopback,preferredPort);
        try{listener.Start();}catch(SocketException){listener=new TcpListener(IPAddress.Loopback,0);listener.Start();}
        Origin="http://127.0.0.1:"+((IPEndPoint)listener.LocalEndpoint).Port+"/";
        Task.Run((Func<Task>)AcceptLoop);
    }
    private async Task AcceptLoop() {
        while(!stopped) {
            try { var client=await listener.AcceptTcpClientAsync();ThreadPool.QueueUserWorkItem(o=>Serve(client)); }
            catch(ObjectDisposedException){break;}catch(SocketException){if(stopped)break;}
        }
    }
    private void Serve(TcpClient client) {
        using(client) {
            client.ReceiveTimeout=5000;client.SendTimeout=15000;
            try {
                using(var stream=client.GetStream()) {
                    var header=new MemoryStream();int last=0,b;
                    while(header.Length<16384&&(b=stream.ReadByte())!=-1) {
                        header.WriteByte((byte)b);last=(last<<8)|b;if(last==0x0d0a0d0a)break;
                    }
                    if(last!=0x0d0a0d0a){Respond(stream,400,"text/plain",Encoding.UTF8.GetBytes("Bad request"),false);return;}
                    var first=Encoding.ASCII.GetString(header.ToArray()).Split(new[]{"\r\n"},StringSplitOptions.None)[0].Split(' ');
                    if(first.Length<3||(first[0]!="GET"&&first[0]!="HEAD")){Respond(stream,405,"text/plain",new byte[0],false);return;}
                    var request=first[1].Split('?')[0];
                    string relative;
                    try {relative=Uri.UnescapeDataString(request).Replace('/',Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);}
                    catch {Respond(stream,400,"text/plain",new byte[0],false);return;}
                    if(relative.Length==0)relative="index.html";
                    if(relative.IndexOf('\0')>=0||relative.Contains(":")){Respond(stream,403,"text/plain",new byte[0],false);return;}
                    string target;
                    try{target=Path.GetFullPath(Path.Combine(root,relative));}catch{Respond(stream,403,"text/plain",new byte[0],false);return;}
                    if(!target.StartsWith(root,StringComparison.OrdinalIgnoreCase)){Respond(stream,403,"text/plain",new byte[0],false);return;}
                    if(!File.Exists(target)){Respond(stream,404,"text/plain",Encoding.UTF8.GetBytes("Not found"),false);return;}
                    var ext=Path.GetExtension(target).ToLowerInvariant();
                    var mime=ext==".html"?"text/html; charset=utf-8":ext==".js"||ext==".mjs"?"text/javascript":ext==".css"?"text/css":ext==".wasm"?"application/wasm":ext==".svg"?"image/svg+xml":ext==".png"?"image/png":ext==".json"?"application/json":"application/octet-stream";
                    byte[] data;
                    using(var file=new FileStream(target,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)) {data=new byte[file.Length];int offset=0,n;while(offset<data.Length&&(n=file.Read(data,offset,data.Length-offset))>0)offset+=n;}
                    Respond(stream,200,mime,data,first[0]=="HEAD");
                }
            } catch(IOException){}catch(ObjectDisposedException){}catch(Exception){}
        }
    }
    private static void Respond(NetworkStream stream,int status,string mime,byte[] data,bool head) {
        var text="HTTP/1.1 "+status+" "+(status==200?"OK":"Error")+"\r\nContent-Type: "+mime+"\r\nContent-Length: "+data.Length+"\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n";
        var bytes=Encoding.ASCII.GetBytes(text);stream.Write(bytes,0,bytes.Length);if(!head)stream.Write(data,0,data.Length);
    }
    public void Dispose(){stopped=true;if(listener!=null)listener.Stop();}
}

public sealed class AirLabWindow : Form {
    private WebView2 web;
    private LocalAssetServer server;
    private readonly ToolStrip toolbar=new ToolStrip();
    private readonly ToolStripLabel status=new ToolStripLabel("Starting AirLab…");
    private readonly ToolStripButton apply=new ToolStripButton("Apply update");
    private readonly ToolStripLabel version=new ToolStripLabel();
    private readonly System.Windows.Forms.Timer poll=new System.Windows.Forms.Timer();
    private string loadedFingerprint="";
    private bool cameraAllowed;
    private bool isReady;
    private readonly bool smokeTest;

    public AirLabWindow(bool test) {
        smokeTest=test;Text="AirLab Studio";Width=1400;Height=950;MinimumSize=new Size(780,600);StartPosition=FormStartPosition.CenterScreen;
        BackColor=Color.FromArgb(10,11,18);
        string iconPath=Path.Combine(Program.AppDirectory,"AirLab.ico");if(File.Exists(iconPath))Icon=new Icon(iconPath);
        toolbar.GripStyle=ToolStripGripStyle.Hidden;toolbar.Padding=new Padding(12,7,12,7);toolbar.BackColor=Color.FromArgb(20,23,37);toolbar.ForeColor=Color.FromArgb(225,229,246);toolbar.RenderMode=ToolStripRenderMode.System;
        var brand=new ToolStripLabel("AIRLAB STUDIO  /  WINDOWS");brand.Font=new Font("Segoe UI",10,FontStyle.Bold);toolbar.Items.Add(brand);
        toolbar.Items.Add(new ToolStripSeparator());version.Text=ReadVersion();toolbar.Items.Add(version);
        toolbar.Items.Add(new ToolStripSeparator());toolbar.Items.Add(status);
        apply.Alignment=ToolStripItemAlignment.Right;apply.Enabled=false;apply.BackColor=Color.FromArgb(184,162,255);apply.ForeColor=Color.FromArgb(26,18,43);apply.Click+=(s,e)=>ReloadProject();toolbar.Items.Add(apply);
        var check=new ToolStripButton("Check for updates");check.Alignment=ToolStripItemAlignment.Right;check.Click+=(s,e)=>CheckUpdates(true);toolbar.Items.Add(check);
        var folder=new ToolStripButton("Source project");folder.Alignment=ToolStripItemAlignment.Right;folder.Click+=(s,e)=>OpenSource();toolbar.Items.Add(folder);
        var reload=new ToolStripButton("Reload");reload.Alignment=ToolStripItemAlignment.Right;reload.Click+=(s,e)=>ReloadProject();toolbar.Items.Add(reload);
        web=new WebView2();web.Dock=DockStyle.Fill;Controls.Add(web);Controls.Add(toolbar);toolbar.Dock=DockStyle.Top;
        Shown+=async(s,e)=>await Initialize();
        FormClosed+=(s,e)=>{poll.Stop();web.Dispose();if(server!=null)server.Dispose();};
        poll.Interval=3000;poll.Tick+=(s,e)=>CheckUpdates(false);
    }
    private string ReadVersion() {
        try {
            var file=Path.Combine(Program.SourceRoot,"desktop","version.json");
            if(!File.Exists(file))file=Path.Combine(Program.AppDirectory,"version.json");
            var value=Program.Json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(file));
            return "v"+value["version"].ToString();
        }catch{return "v2.1.0";}
    }
    private string Fingerprint() {
        var entries=Directory.GetFiles(Program.AssetRoot,"*",SearchOption.AllDirectories).OrderBy(p=>p,StringComparer.OrdinalIgnoreCase).Select(p=>{var f=new FileInfo(p);return p+"|"+f.Length+"|"+f.LastWriteTimeUtc.Ticks;}).ToList();
        var metadata=Path.Combine(Program.SourceRoot,"desktop","version.json");if(File.Exists(metadata))entries.Add(File.ReadAllText(metadata));
        return String.Join("\n",entries);
    }
    private async Task Initialize() {
        try {
            server=new LocalAssetServer(Program.AssetRoot);server.Start(43791);
            var dataFolder=String.IsNullOrWhiteSpace(Program.Config.profileRoot)?Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"AirLab","WebView2"):Program.Config.profileRoot;
            var env=await CoreWebView2Environment.CreateAsync(null,dataFolder);
            await web.EnsureCoreWebView2Async(env);
            web.CoreWebView2.Settings.IsStatusBarEnabled=false;
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
            web.CoreWebView2.Settings.AreDevToolsEnabled=true;
            web.CoreWebView2.PermissionRequested+=(s,e)=>{
                var trusted=e.Uri.StartsWith(server.Origin,StringComparison.Ordinal);
                if(trusted&&e.PermissionKind==CoreWebView2PermissionKind.Camera) {
                    if(!cameraAllowed)cameraAllowed=MessageBox.Show(this,"Allow AirLab to use your camera for hand tracking?\n\nVideo is processed locally. The microphone is not used. Choose your built-in or USB webcam in Camera source.","AirLab camera",MessageBoxButtons.YesNo,MessageBoxIcon.Question)==DialogResult.Yes;
                    e.State=cameraAllowed?CoreWebView2PermissionState.Allow:CoreWebView2PermissionState.Deny;
                } else e.State=CoreWebView2PermissionState.Deny;
                e.SavesInProfile=false;
            };
            web.CoreWebView2.NewWindowRequested+=(s,e)=>{e.Handled=true;OpenLink(e.Uri);};
            web.CoreWebView2.NavigationStarting+=(s,e)=>{if(!e.Uri.StartsWith(server.Origin,StringComparison.Ordinal)&&e.Uri!="about:blank"){e.Cancel=true;if(e.IsUserInitiated)OpenLink(e.Uri);}};
            web.CoreWebView2.NavigationCompleted+=async(s,e)=>{
                if(!e.IsSuccess){status.Text="Could not load the playground";return;}
                loadedFingerprint=Fingerprint();apply.Enabled=false;isReady=true;version.Text=ReadVersion();status.Text="Local app · source linked";Text="AirLab — Physics at your fingertips";
                if(smokeTest) {
                    await Task.Delay(1800);
                    var report=await web.CoreWebView2.ExecuteScriptAsync("JSON.stringify({title:document.title,objects:document.querySelector('#object-count')?.textContent,multiHand:!!document.querySelector('#hand-limit'),cameraPicker:!!document.querySelector('#camera-source'),fps:document.querySelector('#fps')?.textContent,secureContext:window.isSecureContext})");
                    File.WriteAllText(Path.Combine(Program.AppDirectory,"window-smoke-test.json"),report);Close();
                }
            };
            web.CoreWebView2.ProcessFailed+=(s,e)=>{status.Text="The playground stopped. Select Reload.";};
            loadedFingerprint=Fingerprint();web.CoreWebView2.Navigate(server.Origin);poll.Start();
        } catch(Exception ex) {
            status.Text="Startup failed";
            if(smokeTest){File.WriteAllText(Path.Combine(Program.AppDirectory,"window-smoke-error.txt"),ex.ToString());Close();return;}
            MessageBox.Show(this,"AirLab could not open its Windows web engine.\n\n"+ex.Message+"\n\nIf WebView2 is missing, install Microsoft Edge WebView2 Runtime from Microsoft.","AirLab",MessageBoxButtons.OK,MessageBoxIcon.Error);
        }
    }
    private void CheckUpdates(bool showResult) {
        if(!isReady)return;
        try {
            bool changed=Fingerprint()!=loadedFingerprint;apply.Enabled=changed;
            status.Text=changed?"Project update ready · save your experiment before reloading":"Local app · source linked";
            Text=changed?"AirLab — Update ready":"AirLab — Physics at your fingertips";
            if(showResult&&!changed)MessageBox.Show(this,"AirLab is using the latest files in your linked source project.\n\nAsk ChatGPT to update the AirLab project. Changes will appear here as an update, then choose Apply update.\n\nThis checks your local project, not an internet release service.","AirLab updates",MessageBoxButtons.OK,MessageBoxIcon.Information);
        }catch{status.Text="Source project unavailable · check its folder";}
    }
    private void ReloadProject(){if(isReady){cameraAllowed=false;web.CoreWebView2.Reload();}}
    private void OpenSource(){if(Directory.Exists(Program.SourceRoot))Process.Start(new ProcessStartInfo(Program.SourceRoot){UseShellExecute=true});else MessageBox.Show(this,"This portable copy is using its bundled files. Open the original AirLab project to continue development.","AirLab source");}
    private void OpenLink(string url){Uri uri;if(Uri.TryCreate(url,UriKind.Absolute,out uri)&&(uri.Scheme=="https"||uri.Scheme=="http"))Process.Start(new ProcessStartInfo(uri.AbsoluteUri){UseShellExecute=true});}
}
