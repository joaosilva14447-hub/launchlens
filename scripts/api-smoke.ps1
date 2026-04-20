$ErrorActionPreference = "Stop"

$envFile = Join-Path $PSScriptRoot "..\.env.local"
if (-not (Test-Path $envFile)) {
  throw ".env.local not found."
}

$apiKey = ((Get-Content $envFile) | Where-Object { $_ -match '^BIRDEYE_API_KEY=' } | Select-Object -First 1) -replace '^BIRDEYE_API_KEY=', ''
if (-not $apiKey) {
  throw "BIRDEYE_API_KEY missing in .env.local"
}

$headers = @{
  "X-API-KEY" = $apiKey
  "accept" = "application/json"
  "x-chain" = "solana"
}

function Invoke-BirdeyeJson {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Uri
  )

  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    try {
      return Invoke-RestMethod -Uri $Uri -Headers $headers
    } catch {
      $message = $_.Exception.Message
      if ($message -match "Too many requests" -and $attempt -lt 2) {
        Start-Sleep -Milliseconds (1200 * ($attempt + 1))
        continue
      }
      throw
    }
  }
}

$now = [int][double]::Parse((Get-Date -UFormat %s))
$listing = Invoke-BirdeyeJson -Uri "https://public-api.birdeye.so/defi/v2/tokens/new_listing?time_to=$now&limit=5&meme_platform_enabled=true"

$tokens = @()
foreach ($item in $listing.data.items | Select-Object -First 2) {
  Start-Sleep -Milliseconds 1100
  $overview = Invoke-BirdeyeJson -Uri "https://public-api.birdeye.so/defi/token_overview?address=$($item.address)&frames=1h,24h&ui_amount_mode=scaled"
  $tokens += [pscustomobject]@{
    address = $item.address
    symbol = $overview.data.symbol
    name = $overview.data.name
    liquidity = $overview.data.liquidity
    price = $overview.data.price
    priceChange1hPercent = $overview.data.priceChange1hPercent
    volume24h = $overview.data.v24hUSD
    holderCount = $overview.data.holder
  }
}

$trendingStatus = "ok"
try {
  Start-Sleep -Milliseconds 1100
  $null = Invoke-BirdeyeJson -Uri "https://public-api.birdeye.so/defi/token_trending?sort_by=rank&sort_type=asc&interval=1h&offset=0&limit=3&ui_amount_mode=scaled"
} catch {
  $trendingStatus = "unavailable_or_rate_limited"
}

[pscustomobject]@{
  ok = $true
  checkedAt = (Get-Date).ToString("s")
  trendingStatus = $trendingStatus
  tokens = $tokens
} | ConvertTo-Json -Depth 6
