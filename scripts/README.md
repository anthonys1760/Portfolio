# Scripts

## Drawbridge attack table

Guard the generated 8/8 table on `projects/drawbridge/index.html`:

```
node --test scripts/drawbridge-attacks.test.mjs
```

Regenerate the table from `data/drawbridge-attacks.json` after a JSON change:

```
node scripts/build-attack-table.mjs
```
