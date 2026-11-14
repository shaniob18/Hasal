# Downloads today's full price + promotion files for 3 Ashdod branches.
# Osher Ad 009, Yochananof 005 (Cerberus / publishedprices) and Neto Hisachon 197 (binaprojects).
# Output: %USERPROFILE%\Documents\GroceryCompare\data\*.gz  + log.txt

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue'

$root = Join-Path $env:USERPROFILE 'Documents\GroceryCompare'
$out  = Join-Path $root 'data'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$log  = Join-Path $root 'log.txt'
function Log($m) { $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $m"; Write-Host $line; Add-Content -Path $log -Value $line -Encoding UTF8 }

function Get-Csrf($html) {
    $m = [regex]::Match($html, 'name="csrftoken"\s+content="([^"]+)"')
    if (-not $m.Success) { throw 'csrftoken not found' }
    return $m.Groups[1].Value
}

function Get-Cerberus($user, $store, $tag) {
    $base = 'https://url.publishedprices.co.il'
    $r = Invoke-WebRequest "$base/login" -UseBasicParsing -SessionVariable s
    $tok = Get-Csrf $r.Content
    $null = Invoke-WebRequest "$base/login/user" -Method Post -WebSession $s -UseBasicParsing `
        -Body @{ r=''; username=$user; password=''; Submit='Sign in'; csrftoken=$tok }
    $r = Invoke-WebRequest "$base/file" -WebSession $s -UseBasicParsing
    $tok = Get-Csrf $r.Content
    $body = @{ sEcho='1'; iDisplayStart='0'; iDisplayLength='100000'; sSearch=''; iSortCol_0='0'; sSortDir_0='asc'; cd='/'; csrftoken=$tok }
    $r = Invoke-WebRequest "$base/file/json/dir" -Method Post -WebSession $s -UseBasicParsing -Body $body
    $names = ($r.Content | ConvertFrom-Json).aaData | ForEach-Object { $_.fname }
    foreach ($kind in 'PriceFull','PromoFull') {
        $f = $names | Where-Object { $_ -match "^$kind\d+-\d+-$store-" } | Sort-Object | Select-Object -Last 1
        if (-not $f) { Log "$tag $kind not found"; continue }
        Invoke-WebRequest "$base/file/d/$f" -WebSession $s -UseBasicParsing -OutFile (Join-Path $out "${tag}_$kind.gz")
        Log "$tag $kind <- $f"
    }
}

function Get-Bina($host_, $store, $tag) {
    $base = "https://$host_"
    $null = Invoke-WebRequest "$base/Main.aspx" -UseBasicParsing -SessionVariable s
    foreach ($pair in @(@('PriceFull','4'), @('PromoFull','5'))) {
        $kind = $pair[0]
        $r = Invoke-WebRequest "$base/MainIO_Hok.aspx" -Method Post -WebSession $s -UseBasicParsing `
            -Body @{ wReshet=''; WStore=$store; WDate=''; WFileType=$pair[1] }
        $list = $r.Content | ConvertFrom-Json
        $f = @($list) | ForEach-Object { $_.FileNm } | Sort-Object | Select-Object -Last 1
        if (-not $f) { Log "$tag $kind not found"; continue }
        $r = Invoke-WebRequest "$base/Download.aspx?FileNm=$f" -Method Post -WebSession $s -UseBasicParsing
        $url = (($r.Content | ConvertFrom-Json)[0]).SPath
        Invoke-WebRequest $url -WebSession $s -UseBasicParsing -OutFile (Join-Path $out "${tag}_$kind.gz")
        Log "$tag $kind <- $f"
    }
}

$jobs = @(
    @{ tag='osherad_009';   run={ Get-Cerberus 'osherad'   '009' 'osherad_009' } },
    @{ tag='yohananof_005'; run={ Get-Cerberus 'yohananof' '005' 'yohananof_005' } },
    @{ tag='neto_197';      run={ Get-Bina 'supersapir.binaprojects.com' '197' 'neto_197' } }
)
$ok = 0
foreach ($j in $jobs) {
    try { & $j.run; $ok++ } catch { Log "$($j.tag) FAILED: $($_.Exception.Message)" }
}
Set-Content -Path (Join-Path $out 'updated.txt') -Value (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') -Encoding ASCII
Log "done: $ok/3 chains"
