"""Copies the print page layout from the website into the assistant, so both print exactly the same.
Run from the repository root:  python3 assistant/update-layout.py"""
src = open('public/app/app.js').read()

def fn(name):
    i = src.index('function ' + name + '(')
    k = src.rfind('\n', 0, i)
    while True:   # keep the comment lines just above the function
        prev = src.rfind('\n', 0, k)
        if src[prev + 1:k].startswith('//'): k = prev
        else: break
    j, d = src.index('{', i), 0
    for p in range(j, len(src)):
        if src[p] == '{': d += 1
        elif src[p] == '}':
            d -= 1
            if d == 0: return src[k + 1:p + 1]

i = src.index('const PAPER = ')
out = ('// Page layout for printing: copied from the website (public/app/app.js) so prints come out exactly the same.\n'
       '// If these change there, copy them again (assistant/update-layout.py does it).\n'
       + src[i:src.index('\n', i)] + '\n' + '\n'.join(fn(n) for n in ['whiteEdges', 'withBleed', 'twinParts', 'printPage', 'rotatedCanvas']) + '\n')
open('assistant/ui/printlayout.js', 'w').write(out)
print('assistant/ui/printlayout.js updated')
