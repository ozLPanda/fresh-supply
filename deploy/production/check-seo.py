#!/usr/bin/env python3
"""Read-only check of actual HTTP SEO responses, without JavaScript or third-party packages."""
import argparse
import json
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from html.parser import HTMLParser


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.canonical = None
        self.title = ''
        self.in_title = False
        self.in_json = False
        self.json_text = ''
        self.schemas = []
        self.h1 = False
        self.scripts = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'link' and a.get('rel') == 'canonical':
            self.canonical = a.get('href')
        if tag == 'title':
            self.in_title = True
        if tag == 'h1':
            self.h1 = True
        if tag == 'script':
            self.in_json = a.get('type') == 'application/ld+json'
            self.json_text = ''
            if a.get('src'):
                self.scripts.append(a['src'])

    def handle_data(self, data):
        if self.in_title:
            self.title += data
        if self.in_json:
            self.json_text += data

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
        if tag == 'script' and self.in_json:
            value = json.loads(self.json_text)
            self.schemas.extend(value if isinstance(value, list) else [value])
            self.in_json = False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('origin', help='Public HTTPS origin, e.g. https://shop.example.com')
    parser.add_argument('--insecure', action='store_true', help='Local self-signed TLS only')
    args = parser.parse_args()
    origin = args.origin.rstrip('/')
    context = ssl._create_unverified_context() if args.insecure else ssl.create_default_context()

    def get(url, expected=200):
        # Reject sitemap entries outside the requested site.
        assert urllib.parse.urlsplit(url).netloc == urllib.parse.urlsplit(origin).netloc, url
        request = urllib.request.Request(url, headers={'User-Agent': 'CompanyShopSeoCheck/1.0'})
        try:
            response = urllib.request.urlopen(request, timeout=20, context=context)
        except urllib.error.HTTPError as error:
            response = error
        assert response.status == expected, f'{url}: HTTP {response.status}, expected {expected}'
        return response.headers, response.read().decode('utf-8')

    headers, robots = get(origin + '/robots.txt')
    assert 'text/plain' in headers.get('Content-Type', ''), 'robots.txt must be plain text'
    assert 'User-agent:' in robots and f'Sitemap: {origin}/sitemap.xml' in robots
    headers, xml = get(origin + '/sitemap.xml')
    assert 'xml' in headers.get('Content-Type', ''), 'sitemap.xml must be XML'
    root = ET.fromstring(xml)
    ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
    assert root.tag.endswith('sitemapindex'), 'Expected a sitemap index'
    maps = [e.text for e in root.findall('s:sitemap/s:loc', ns)]
    product_map = next((url for url in maps if '/sitemap-products-' in url), None)
    assert product_map, 'No product sitemap: check active catalog products'
    _, product_xml = get(product_map)
    products = ET.fromstring(product_xml)
    product_url = products.find('s:url/s:loc', ns).text
    headers, html = get(product_url)
    assert 'text/html' in headers.get('Content-Type', '')
    page = Page()
    page.feed(html)
    assert page.canonical == product_url, 'Wrong product canonical'
    assert page.title.strip() and page.h1, 'Product title/H1 missing from initial HTML'
    schema = next((s for s in page.schemas if s.get('@type') == 'Product'), None)
    assert schema and schema.get('name') and schema.get('sku'), 'Product JSON-LD missing'
    assert page.scripts, 'App JavaScript missing: users cannot load interactive storefront'
    # Verify the served app shell references an existing asset from the same release.
    get(urllib.parse.urljoin(origin, page.scripts[0]))
    get(origin + '/product/9223372036854775807', expected=404)
    print(f'PASS: robots, sitemap index, product HTML/schema/canonical/app asset, missing product 404\n{product_url}')


if __name__ == '__main__':
    try:
        main()
    except (AssertionError, ValueError, OSError, ET.ParseError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        sys.exit(1)
