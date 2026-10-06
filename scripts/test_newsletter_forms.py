import urllib.request
import re
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

venues = [
    ('The Cultch', 'https://thecultch.com/'),
    ('Rio Theatre', 'https://riotheatre.ca/'),
    ('The Cinematheque', 'https://thecinematheque.ca/'),
    ('VIFF', 'https://viff.org/'),
    ('Rickshaw Theatre', 'https://rickshawtheatre.com/'),
    ('Fox Cabaret', 'https://www.foxcabaret.com/'),
    ('Little Mountain Gallery', 'https://littlemountaingallery.ca/'),
    ('The Improv Centre', 'https://theimprovcentre.ca/'),
    ('Firehall Arts Centre', 'https://firehallartscentre.ca/'),
    ('Vancouver Civic Theatres', 'https://vancouvercivictheatres.com/')
]

for name, url in venues:
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        html = urllib.request.urlopen(req, context=ctx, timeout=10).read().decode('utf-8', errors='ignore')
        forms = re.findall(r'<form\b[^>]*action=["\']([^"\']*)["\']', html, re.IGNORECASE)
        has_newsletter = any(k in html.lower() for k in ['newsletter', 'subscribe', 'mailing list', 'mailchimp'])
        mailchimp_urls = re.findall(r'https?://[a-zA-Z0-9.\-_]*mailchimp\.com[^\s"\'<>]*', html)
        print(f"{name}: forms={len(forms)} | newsletter_words={has_newsletter} | mailchimp={len(mailchimp_urls)}")
        if forms:
            print(f"   actions: {forms[:2]}")
        if mailchimp_urls:
            print(f"   mc: {mailchimp_urls[:2]}")
    except Exception as e:
        print(f"{name}: error {e}")
