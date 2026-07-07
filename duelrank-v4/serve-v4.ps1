$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Parse('127.0.0.1'), 8082)
$listener.Start()

function Get-ContentType($path) {
  switch -Regex ($path) {
    '\.html$' { 'text/html; charset=utf-8'; break }
    '\.css$' { 'text/css; charset=utf-8'; break }
    '\.js$' { 'text/javascript; charset=utf-8'; break }
    '\.csv$' { 'text/csv; charset=utf-8'; break }
    '\.json$' { 'application/json; charset=utf-8'; break }
    default { 'application/octet-stream' }
  }
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = [IO.StreamReader]::new($stream)
    $line = $reader.ReadLine()
    if (-not $line) { continue }

    while ($true) {
      $header = $reader.ReadLine()
      if ($null -eq $header -or $header -eq '') { break }
    }

    $parts = $line.Split(' ')
    $requestPath = [Uri]::UnescapeDataString($parts[1].Split('?')[0].TrimStart('/'))
    if ([string]::IsNullOrWhiteSpace($requestPath)) { $requestPath = 'index.html' }

    $file = Join-Path $root $requestPath
    $resolved = Resolve-Path $file -ErrorAction SilentlyContinue
    if ($resolved -and $resolved.Path.StartsWith($root)) {
      $body = [IO.File]::ReadAllBytes($resolved.Path)
      $status = 'HTTP/1.1 200 OK'
      $type = Get-ContentType $resolved.Path
    } else {
      $body = [Text.Encoding]::UTF8.GetBytes('Not found')
      $status = 'HTTP/1.1 404 Not Found'
      $type = 'text/plain; charset=utf-8'
    }

    $responseHeader = "$status`r`nContent-Type: $type`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
    $headerBytes = [Text.Encoding]::ASCII.GetBytes($responseHeader)
    $stream.Write($headerBytes, 0, $headerBytes.Length)
    $stream.Write($body, 0, $body.Length)
  } catch {
    try {
      $body = [Text.Encoding]::UTF8.GetBytes($_.Exception.Message)
      $responseHeader = "HTTP/1.1 500 Internal Server Error`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n"
      $headerBytes = [Text.Encoding]::ASCII.GetBytes($responseHeader)
      $stream.Write($headerBytes, 0, $headerBytes.Length)
      $stream.Write($body, 0, $body.Length)
    } catch {}
  } finally {
    $client.Close()
  }
}
