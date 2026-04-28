# COWORK EXECUTION SCRIPT — AYBKK.ORG Shopify Homepage
# Theme: Origin (draft)
# Goal: Install the AYBKK educational hub homepage

---

## STEP 1 — Go to the theme code editor

1. Navigate to: https://admin.shopify.com/store/7bdc65-2/themes
2. Find the draft theme called "Origin"
3. Click the three-dot menu (⋯) next to it → click "Edit code"
4. You are now in the Shopify code editor

---

## STEP 2 — Create the section file

1. In the left sidebar, find the folder called **"Sections"** — click it to expand
2. Click **"Add a new section"**
3. A dialog will ask for a file name. Type exactly:
   `aybkk-org-home`
   Then click "Done" or press Enter
4. A new file `aybkk-org-home.liquid` will open with some default code inside
5. **Select ALL the existing code** (Cmd+A on Mac) and **delete it** — the editor should be completely empty
6. Open the file: `/Users/alfredoagent/mission-control/shopify-org/sections/aybkk-org-home.liquid`
7. Copy the ENTIRE contents of that file
8. Paste it into the empty Shopify editor
9. Click **Save** (top right button)
10. You should see "Saved" confirmation — no errors

---

## STEP 3 — Update the homepage template

1. In the left sidebar, find the folder called **"Templates"** — click it
2. Find and click the file called **`index.json`**
3. **Select ALL the existing code** (Cmd+A) and **delete it**
4. Open the file: `/Users/alfredoagent/mission-control/shopify-org/templates/index.json`
5. Copy the entire contents:
```
{
  "sections": {
    "aybkk-org-home": {
      "type": "aybkk-org-home",
      "settings": {}
    }
  },
  "order": [
    "aybkk-org-home"
  ]
}
```
6. Paste it into the Shopify editor (replacing everything)
7. Click **Save**

---

## STEP 4 — Hide the theme's default header and footer

The Origin theme will try to show its own nav bar and footer on top of ours.
We need to hide them for the homepage only.

1. In the left sidebar, find **"Layout"** folder → click `theme.liquid`
2. Use Cmd+F to search for: `header`
3. Look for a line like: `{% section 'header' %}` or `{% render 'header' %}`
4. Wrap it with a conditional so it only shows on non-homepage pages:

   FIND this line (it may look slightly different):
   ```
   {% section 'header' %}
   ```
   REPLACE with:
   ```
   {% unless template == 'index' %}
     {% section 'header' %}
   {% endunless %}
   ```

5. Do the same for the footer — find `{% section 'footer' %}` and wrap:
   ```
   {% unless template == 'index' %}
     {% section 'footer' %}
   {% endunless %}
   ```

6. Click **Save**

---

## STEP 5 — Preview the homepage

1. Go back to: https://admin.shopify.com/store/7bdc65-2/themes
2. Find the Origin draft theme
3. Click **"Preview"**
4. The AYBKK.ORG homepage should appear — dark hero, parchment sections, all 5 sections visible

---

## STEP 6 — Publish (only when ready)

1. Go to: https://admin.shopify.com/store/7bdc65-2/themes
2. Find Origin draft theme
3. Click **"Publish"**
4. Confirm

---

## IF ANYTHING GOES WRONG

- If Step 2 gives an error "section already exists" — just click the existing `aybkk-org-home.liquid` file and overwrite it
- If the preview shows a blank page — the index.json likely has a typo. Re-paste it exactly as shown in Step 3
- If you see two nav bars — the theme.liquid header/footer hide in Step 4 wasn't saved. Try again.
- Report back what error message you see and Claude Code will fix it.
