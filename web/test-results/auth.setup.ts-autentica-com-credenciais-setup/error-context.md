# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.setup.ts >> autentica com credenciais
- Location: tests/e2e/auth.setup.ts:5:6

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForURL: Test timeout of 30000ms exceeded.
=========================== logs ===========================
waiting for navigation until "load"
============================================================
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e3]:
      - generic [ref=e4]:
        - img "WaterWorks" [ref=e5]
        - heading "Aprovações · Omie" [level=1] [ref=e6]
        - paragraph [ref=e7]: Entre com seu email e senha.
      - generic [ref=e8]:
        - textbox "email@waterworks.com.br" [ref=e9]: benny@waterworks.com.br
        - textbox "senha" [ref=e10]: sua_senha
        - button "Entrar" [ref=e11] [cursor=pointer]
        - link "Esqueci a senha" [ref=e13] [cursor=pointer]:
          - /url: /recover
      - generic [ref=e14]: Invalid login credentials
  - alert [ref=e15]
```

# Test source

```ts
  1  | import { test as setup, expect } from "@playwright/test";
  2  | 
  3  | const authFile = "tests/.auth/user.json";
  4  | 
  5  | setup("autentica com credenciais", async ({ page }) => {
  6  |   const email = process.env.E2E_EMAIL!;
  7  |   const password = process.env.E2E_PASSWORD!;
  8  |   if (!email || !password) throw new Error("Defina E2E_EMAIL e E2E_PASSWORD");
  9  | 
  10 |   await page.goto("/login");
  11 |   await page.locator("input[type=email]").first().fill(email);
  12 |   await page.locator("input[type=password]").first().fill(password);
  13 |   // Clica em qualquer botão submit do form
  14 |   await page.locator("button[type=submit], form button").first().click();
  15 | 
  16 |   // Espera redirect pra rota autenticada (/, /avulsos, etc)
> 17 |   await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 60_000 });
     |              ^ Error: page.waitForURL: Test timeout of 30000ms exceeded.
  18 |   // Grava state pra reusar em outros specs
  19 |   await page.context().storageState({ path: authFile });
  20 | });
  21 | 
```