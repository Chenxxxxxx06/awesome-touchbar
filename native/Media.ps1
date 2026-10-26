param([switch]$AllowWrite)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
$propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Await($operation, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
  if (-not $task.Wait(3500)) { throw 'Media request timed out' }
  return $task.Result
}
$manager = Await ($managerType::RequestAsync()) $managerType
function Read-Sessions {
  $current = $manager.GetCurrentSession()
  foreach ($session in $manager.GetSessions()) {
    try {
      $props = Await ($session.TryGetMediaPropertiesAsync()) $propertiesType
      $playback = $session.GetPlaybackInfo()
      $timeline = $session.GetTimelineProperties()
      $start = [Math]::Max(0, $timeline.StartTime.TotalSeconds)
      $end = [Math]::Max($start, $timeline.EndTime.TotalSeconds)
      $duration = $end - $start
      $source = $session.SourceAppUserModelId
      $identity = @($source, $props.Title, $props.Artist, $props.AlbumTitle, $duration) | ConvertTo-Json -Compress
      $sha = [System.Security.Cryptography.SHA256]::Create()
      try { $token = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
      $playing = $playback.PlaybackStatus.ToString() -eq 'Playing'
      $rate = 1.0
      if ($null -ne $playback.PlaybackRate) { $rate = [double]$playback.PlaybackRate }
      $elapsed = 0.0
      if ($playing -and $timeline.LastUpdatedTime.Year -gt 2000) { $elapsed = [Math]::Max(0, ([DateTimeOffset]::UtcNow - $timeline.LastUpdatedTime).TotalSeconds) * $rate }
      $position = [Math]::Min($duration, [Math]::Max(0, $timeline.Position.TotalSeconds - $start + $elapsed))
      $min = [Math]::Max(0, $timeline.MinSeekTime.TotalSeconds - $start)
      $max = [Math]::Min($duration, $timeline.MaxSeekTime.TotalSeconds - $start)
      # Some players publish only StartTime/EndTime; the explicit capability is still required.
      if ($max -le $min) { $min = 0; $max = $duration }
      [pscustomobject]@{ Session=$session; Start=$start; Public=@{
        token=$token; source=$source; title=[string]$props.Title; artist=[string]$props.Artist; album=[string]$props.AlbumTitle
        duration=$duration; position=$position; playing=$playing; rate=$rate; seekable=($playback.Controls.IsPlaybackPositionEnabled -and $duration -gt 0)
        minSeek=$min; maxSeek=$max; current=($null -ne $current -and $current.Equals($session))
      } }
    } catch { continue }
  }
}
while ($null -ne ($line = [Console]::ReadLine())) {
  $request = $null
  try {
    if ($line.Length -gt 4096) { throw 'Invalid request' }
    $request = $line | ConvertFrom-Json
    $rows = @(Read-Sessions)
    if ($request.op -eq 'seek') {
      if (-not $AllowWrite) { throw 'Read-only media helper' }
      $matches = @($rows | Where-Object { $_.Public.token -ceq $request.token })
      if ($matches.Count -ne 1) { throw 'Track changed or session is ambiguous' }
      $row = $matches[0]
      $seconds = [double]$request.seconds
      if (-not $row.Public.seekable -or [double]::IsNaN($seconds) -or [double]::IsInfinity($seconds) -or $seconds -lt $row.Public.minSeek -or $seconds -gt $row.Public.maxSeek) { throw 'Seek unavailable' }
      $ok = Await ($row.Session.TryChangePlaybackPositionAsync([long](($seconds + $row.Start) * 10000000))) ([bool])
      if (-not $ok) { throw 'Player rejected seek' }
      $result = @{ accepted=$true }
    } elseif ($request.op -eq 'state') {
      $result = @{ sessions=@($rows | ForEach-Object { $_.Public }); observedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
    } else { throw 'Unknown operation' }
    $response = @{ id=$request.id; ok=$true; result=$result }
  } catch { $response = @{ id=$request.id; ok=$false; error='Media operation unavailable; refresh the current track' } }
  [Console]::WriteLine(($response | ConvertTo-Json -Depth 6 -Compress))
}
