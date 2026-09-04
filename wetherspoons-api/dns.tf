resource "cloudflare_zone" "spoons_cheap" {
  zone = "spoons.cheap"
}

resource "cloudflare_record" "api_spoons_cheap" {
  zone_id = cloudflare_zone.spoons_cheap.id
  name    = "api"
  value   = aws_cloudfront_distribution.wetherspoons_api.domain_name
  type    = "CNAME"
}

resource "cloudflare_record" "spoons_cheap" {
  zone_id = cloudflare_zone.spoons_cheap.id
  name    = "@"
  value   = "spoons-cheap.pages.dev"
  type    = "CNAME"
}

resource "cloudflare_record" "www_spoons_cheap" {
  zone_id = cloudflare_zone.spoons_cheap.id
  name    = "www"
  value   = "spoons.cheap"
  type    = "CNAME"
}
