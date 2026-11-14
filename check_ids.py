import re

with open('index.html', encoding='utf-8') as f:
    html = f.read()

with open('js/app.js', encoding='utf-8') as f:
    app_js = f.read()

by_id = set(re.findall(r"getElementById\(['\"](.*?)['\"]\)", app_js))
html_ids = set(re.findall(r"id=['\"](.*?)['\"]", html))

missing_in_html = by_id - html_ids
print('IDs in app.js but missing in html:', missing_in_html)

onclicks = set(re.findall(r"onclick=['\"]([a-zA-Z0-9_]+)\(", html))
print('Unique onclick functions:', onclicks)
for fn in onclicks:
    if f"function {fn}" not in app_js and f"{fn} =" not in app_js:
        print('  WARNING: onclick function not defined in app.js:', fn)
    else:
        print('  OK: onclick function defined:', fn)
