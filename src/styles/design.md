# Claude Design System

Versão **2.0.0** · 4 temas · Light & Dark

---

## Índice

1. [Visão Geral](#visão-geral)
2. [Temas](#temas)
3. [Paleta de Cores](#paleta-de-cores)
4. [Tokens Semânticos](#tokens-semânticos)
5. [Tipografia](#tipografia)
6. [Espaçamento](#espaçamento)
7. [Border Radius](#border-radius)
8. [Sombras](#sombras)
9. [Componentes](#componentes)
10. [Instalação & Uso](#instalação--uso)

---

## Visão Geral

O Claude Design System é uma coleção de tokens, componentes e guias de estilo construída sobre a identidade visual do Claude / Anthropic. Ele oferece **4 temas intercambiáveis** — dois baseados em azul e dois em laranja — cada um com variantes claro e escuro.

O sistema usa exclusivamente **CSS Custom Properties** (variáveis CSS), o que permite:
- Troca de tema em tempo real sem recarregar a página
- Manutenção centralizada via um único arquivo `design.css`
- Compatibilidade com qualquer framework (React, Vue, Svelte, vanilla)

---

## Temas

O tema é definido pelo atributo `data-theme` no elemento raiz:

```html
<html data-theme="blue-light">
<html data-theme="blue-dark">
<html data-theme="orange-light">
<html data-theme="orange-dark">
```

Via JavaScript:

```js
document.documentElement.setAttribute('data-theme', 'orange-dark');
```

### Resumo dos 4 temas

| Tema | Classe | Primário | Fundo | Modo |
|------|--------|----------|-------|------|
| Azul Claro | `blue-light` | `#1A5CE6` | `#faf9f5` Cream | ☀️ Light |
| Azul Escuro | `blue-dark` | `#4A76EA` | `#1a1815` Warm Dark | 🌙 Dark |
| Laranja Claro | `orange-light` | `#F2762E` | `#faf9f5` Cream | ☀️ Light |
| Laranja Escuro | `orange-dark` | `#F48B48` | `#1a1815` Warm Dark | 🌙 Dark |

> **Nota:** No dark mode, a cor primária é levemente mais clara que no light mode para garantir contraste adequado sobre os fundos escuros.

---

## Paleta de Cores

### Azul `#1A5CE6`

Usada como primária nos temas `blue-light` e `blue-dark`.

| Token | Hex | Uso |
|-------|-----|-----|
| `--blue-50` | `#EEF3FD` | Background hover sutil |
| `--blue-100` | `#D4E2FB` | Background de badges e tags |
| `--blue-200` | `#AABFF6` | Borda de elementos com accent |
| `--blue-300` | `#7898EF` | Focus ring, dark mode hover |
| `--blue-400` | `#4A76EA` | **Primário dark mode** |
| `--blue-500` | `#1A5CE6` | **Primário light mode** ★ |
| `--blue-600` | `#1449B8` | Hover no light mode |
| `--blue-700` | `#0F368A` | Active / texto sobre bg claro |
| `--blue-800` | `#0A245C` | Texto escuro |
| `--blue-900` | `#06142E` | — |
| `--blue-950` | `#030A17` | — |

### Laranja `#F2762E`

Usada como primária nos temas `orange-light` e `orange-dark`.

| Token | Hex | Uso |
|-------|-----|-----|
| `--orange-50` | `#FEF3EB` | Background hover sutil |
| `--orange-100` | `#FDE3CC` | Background de badges e tags |
| `--orange-200` | `#FAC79A` | Borda de elementos com accent |
| `--orange-300` | `#F7A468` | Focus ring, dark mode hover |
| `--orange-400` | `#F48B48` | **Primário dark mode** |
| `--orange-500` | `#F2762E` | **Primário light mode** ★ |
| `--orange-600` | `#D15E1A` | Hover no light mode |
| `--orange-700` | `#A44913` | Active / texto sobre bg claro |
| `--orange-800` | `#77340D` | Texto escuro |
| `--orange-900` | `#4A2008` | — |
| `--orange-950` | `#261003` | — |

### Cream / Pampas (base do light mode)

| Token | Hex | Uso |
|-------|-----|-----|
| `--cream-100` | `#fdfcfb` | Superfície mais clara |
| `--cream-200` | `#faf9f5` | Background da página |
| `--cream-300` | `#f4f3ee` | Pampas — sidebar, bg-subtle |
| `--cream-400` | `#ece9e0` | Hover de itens, bg-muted |
| `--cream-500` | `#e0dcd0` | — |
| `--cream-600` | `#d0cab8` | — |

### Warm Gray / Cloudy (neutros e base do dark mode)

| Token | Hex | Uso |
|-------|-----|-----|
| `--warm-50` | `#f9f8f7` | — |
| `--warm-100` | `#f0eeec` | Code block light |
| `--warm-200` | `#e4e0db` | Borda sutil light |
| `--warm-300` | `#d1ccc4` | Borda padrão light |
| `--warm-400` | `#b1ada1` | **Cloudy** — borda forte, text-dis |
| `--warm-500` | `#918d84` | Texto terciário light |
| `--warm-600` | `#726e67` | Texto desabilitado dark |
| `--warm-700` | `#57534d` | Texto secundário light |
| `--warm-800` | `#3d3a35` | Borda dark, bg-muted dark |
| `--warm-900` | `#2a2723` | bg-subtle dark |
| `--warm-950` | `#1a1815` | **Background do dark mode** |

### Status

| Token base | Hex | bg token | texto token |
|------------|-----|----------|-------------|
| `--status-success` | `#22c55e` | `--status-success-bg` `#d1fae5` | `--status-success-tx` `#15803d` |
| `--status-warning` | `#f59e0b` | `--status-warning-bg` `#fef3c7` | `--status-warning-tx` `#b45309` |
| `--status-error` | `#ef4444` | `--status-error-bg` `#fee2e2` | `--status-error-tx` `#b91c1c` |
| `--status-info` | `#3b82f6` | `--status-info-bg` `#dbeafe` | `--status-info-tx` `#1d4ed8` |

---

## Tokens Semânticos

Estes tokens mudam automaticamente com o tema. **Sempre use estes no seu código**, nunca os valores brutos.

### Backgrounds

| Token | Light | Dark |
|-------|-------|------|
| `--bg` | `#faf9f5` | `#1a1815` |
| `--bg-subtle` | `#f4f3ee` | `#2a2723` |
| `--bg-muted` | `#ece9e0` | `#3d3a35` |
| `--surface` | `#ffffff` | `#252320` |
| `--surface-low` | `#f4f3ee` | `#2a2723` |

### Texto

| Token | Light | Dark |
|-------|-------|------|
| `--text` | `#1a1815` | `#f0ede8` |
| `--text-2` | `#57534d` | `#d1ccc4` |
| `--text-3` | `#918d84` | `#918d84` |
| `--text-dis` | `#b1ada1` | `#726e67` |

### Bordas

| Token | Light | Dark |
|-------|-------|------|
| `--border` | `#d1ccc4` | `#3d3a35` |
| `--border-sub` | `#e4e0db` | `#2e2b27` |
| `--border-str` | `#b1ada1` | `#524e48` |

### Primário (varia por tema)

| Token | Descrição |
|-------|-----------|
| `--primary` | Cor principal do tema ativo |
| `--primary-h` | Hover da cor principal |
| `--primary-a` | Active/pressed da cor principal |
| `--primary-bg` | Background sutil (chips, highlight) |
| `--primary-mu` | Background médio (badges, tags) |
| `--primary-tx` | Texto sobre backgrounds primários |
| `--primary-bd` | Borda com accent |

### Sidebar

| Token | Descrição |
|-------|-----------|
| `--sb-bg` | Fundo da sidebar |
| `--sb-bd` | Borda da sidebar |
| `--sb-hover` | Hover de item |
| `--sb-active` | Item ativo |
| `--sb-text` | Texto de item |
| `--sb-text-a` | Texto de item ativo |

---

## Tipografia

### Fonte principal

**Plus Jakarta Sans** — disponível via Google Fonts.

```html
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
```

### Fonte mono

**JetBrains Mono** — para blocos de código, tokens e valores técnicos.

```html
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

### Escala de tamanhos

| Token | rem | px | Uso |
|-------|-----|----|-----|
| `--text-xs` | `0.75rem` | 12px | Captions, labels uppercase |
| `--text-sm` | `0.875rem` | 14px | Texto secundário, labels |
| `--text-base` | `1rem` | 16px | Corpo de texto |
| `--text-lg` | `1.125rem` | 18px | Corpo grande, H3 pequeno |
| `--text-xl` | `1.25rem` | 20px | H3 |
| `--text-2xl` | `1.5rem` | 24px | H2 |
| `--text-3xl` | `1.875rem` | 30px | — |
| `--text-4xl` | `2.25rem` | 36px | H1 |
| `--text-5xl` | `3rem` | 48px | Display |
| `--text-7xl` | `4.5rem` | 72px | Hero |

### Pesos

| Token | Valor | Uso |
|-------|-------|-----|
| `--weight-light` | 300 | Subtítulos grandes |
| `--weight-regular` | 400 | Corpo de texto |
| `--weight-medium` | 500 | Labels, navegação |
| `--weight-semibold` | 600 | Headings menores, botões |
| `--weight-bold` | 700 | Headings principais |
| `--weight-extrabold` | 800 | Display, hero |

---

## Espaçamento

Base de **4px** (`0.25rem`). Todos os tokens seguem múltiplos de 4.

| Token | rem | px |
|-------|-----|----|
| `--space-1` | `0.25rem` | 4px |
| `--space-2` | `0.5rem` | 8px |
| `--space-3` | `0.75rem` | 12px |
| `--space-4` | `1rem` | 16px |
| `--space-5` | `1.25rem` | 20px |
| `--space-6` | `1.5rem` | 24px |
| `--space-8` | `2rem` | 32px |
| `--space-10` | `2.5rem` | 40px |
| `--space-12` | `3rem` | 48px |
| `--space-14` | `3.5rem` | 56px |
| `--space-16` | `4rem` | 64px |
| `--space-20` | `5rem` | 80px |
| `--space-24` | `6rem` | 96px |
| `--space-32` | `8rem` | 128px |
| `--space-48` | `12rem` | 192px |
| `--space-64` | `16rem` | 256px |

---

## Border Radius

| Token | Valor | Uso recomendado |
|-------|-------|-----------------|
| `--radius-none` | `0` | Tabelas, divisores |
| `--radius-sm` | `4px` | Tooltips, tags inline |
| `--radius-md` | `6px` | Tooltips maiores |
| `--radius-base` | `8px` | Inputs, selects |
| `--radius-lg` | `12px` | Botões, chips |
| `--radius-xl` | `16px` | Cards, dropdowns |
| `--radius-2xl` | `20px` | Modais, sheets |
| `--radius-3xl` | `24px` | Painéis grandes |
| `--radius-full` | `9999px` | Badges, avatares, pills |

### Aliases por componente

| Token | Aponta para |
|-------|-------------|
| `--radius-btn` | `--radius-lg` (12px) |
| `--radius-input` | `--radius-base` (8px) |
| `--radius-card` | `--radius-xl` (16px) |
| `--radius-modal` | `--radius-2xl` (20px) |
| `--radius-badge` | `--radius-full` |
| `--radius-avatar` | `--radius-full` |

---

## Sombras

### Sombras neutras

| Token | Uso |
|-------|-----|
| `--shadow-sm` | Cards em repouso, dropdowns |
| `--shadow-md` | Cards em hover |
| `--shadow-lg` | Modais, painéis flutuantes |
| `--shadow-xl` | Drawers, overlays grandes |

### Sombra colorida (accent)

`--shadow-acc` é definida por cada tema e representa o **glow** da cor primária. Use exclusivamente em elementos interativos com `var(--primary)`.

```css
.btn-primary {
  background: var(--primary);
  box-shadow: var(--shadow-acc);
}
```

### Focus ring

`--focus-ring` é definida por cada tema. Aplique em `:focus-visible`:

```css
:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
```

---

## Componentes

### Botão

```css
.btn {
  height: var(--btn-h-md);           /* 40px */
  padding: 0 var(--btn-px-md);       /* 0 16px */
  border-radius: var(--radius-btn);  /* 12px */
  font-size: var(--btn-fs-md);       /* 14px */
  font-weight: var(--btn-fw);        /* 600 */
  transition: var(--transition-colors), var(--transition-shadow);
}

/* Variante primária */
.btn-primary {
  background: var(--primary);
  color: white;
  box-shadow: var(--shadow-acc);
}
.btn-primary:hover { background: var(--primary-h); }
.btn-primary:active { background: var(--primary-a); }
.btn-primary:focus-visible { box-shadow: var(--focus-ring); }

/* Variante secundária */
.btn-secondary {
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border-str);
}
.btn-secondary:hover {
  border-color: var(--primary);
  color: var(--primary-tx);
  background: var(--primary-bg);
}
```

#### Tamanhos

| Tamanho | Altura | Padding | Font-size | Radius |
|---------|--------|---------|-----------|--------|
| `sm` | 32px | 0 12px | 12.5px | 8px |
| `md` | 40px | 0 16px | 14px | 12px |
| `lg` | 48px | 0 22px | 15px | 12px |

---

### Input

```css
.input {
  height: var(--input-h-md);         /* 40px */
  padding: 0 var(--input-px);        /* 0 12px */
  border-radius: var(--radius-input);/* 8px */
  font-size: var(--input-fs);        /* 14px */
  background: var(--input-bg);
  border: 1px solid var(--input-bd);
  color: var(--text);
  transition: var(--transition-colors), var(--transition-shadow);
}

.input:focus {
  border-color: var(--input-focus);  /* var(--primary) */
  box-shadow: 0 0 0 3px rgba(var(--primary-rgb), 0.15);
  outline: none;
}

.input::placeholder { color: var(--text-dis); }
```

---

### Badge

```css
.badge {
  display: inline-flex;
  align-items: center;
  height: var(--badge-h);            /* 20px */
  padding: 0 var(--badge-px);        /* 0 8px */
  border-radius: var(--radius-badge);/* 9999px */
  font-size: var(--badge-fs);        /* 12px */
  font-weight: var(--badge-fw);      /* 600 */
}

/* Variantes */
.badge-primary { background: var(--primary-mu);         color: var(--primary-tx); }
.badge-success { background: var(--status-success-bg);  color: var(--status-success-tx); }
.badge-warning { background: var(--status-warning-bg);  color: var(--status-warning-tx); }
.badge-error   { background: var(--status-error-bg);    color: var(--status-error-tx); }
.badge-info    { background: var(--status-info-bg);     color: var(--status-info-tx); }
.badge-neutral { background: var(--bg-muted);           color: var(--text-2); }
```

---

### Card

```css
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-card); /* 16px */
  padding: var(--card-p-md);         /* 24px */
  box-shadow: var(--shadow-sm);
  transition: var(--transition-shadow);
}
.card:hover { box-shadow: var(--shadow-md); }
```

---

### Avatar

```css
.avatar {
  width: var(--av-md);               /* 36px */
  height: var(--av-md);
  border-radius: var(--radius-avatar);/* 9999px */
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: var(--weight-bold);
  background: var(--primary-mu);
  color: var(--primary-tx);
}
```

| Tamanho | Variável | px |
|---------|----------|----|
| `sm` | `--av-sm` | 28px |
| `md` | `--av-md` | 36px |
| `lg` | `--av-lg` | 48px |
| `xl` | `--av-xl` | 64px |

---

### Alertas

```css
.alert {
  padding: 12px 14px;
  border-radius: var(--radius-lg);   /* 12px */
  border: 1px solid transparent;
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: var(--text-sm);
}

.alert-success { background: var(--status-success-bg); color: var(--status-success-tx); border-color: rgba(34,197,94,0.3); }
.alert-warning { background: var(--status-warning-bg); color: var(--status-warning-tx); border-color: rgba(245,158,11,0.3); }
.alert-error   { background: var(--status-error-bg);   color: var(--status-error-tx);   border-color: rgba(239,68,68,0.3); }
.alert-info    { background: var(--status-info-bg);    color: var(--status-info-tx);    border-color: rgba(59,130,246,0.3); }
```

---

## Instalação & Uso

### 1. Importar o CSS

```html
<!-- No <head> do seu HTML -->
<link rel="stylesheet" href="design.css">

<!-- Ou via @import no CSS -->
@import './design.css';

<!-- Ou via JavaScript (React, Vue, etc.) -->
import './design.css';
```

### 2. Configurar o tema inicial

```html
<html lang="pt-BR" data-theme="blue-light">
```

### 3. Trocar tema dinamicamente

```js
// Função de alternância de tema
function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

// Restaurar tema salvo
const saved = localStorage.getItem('theme') || 'blue-light';
setTheme(saved);
```

### 4. Usar os tokens

```css
/* ✅ Correto — usa tokens semânticos */
.meu-botao {
  background:    var(--primary);
  box-shadow:    var(--shadow-acc);
  border-radius: var(--radius-btn);
  height:        var(--btn-h-md);
  font-size:     var(--text-sm);
  font-weight:   var(--weight-semibold);
}

/* ❌ Errado — valor fixo não muda com o tema */
.meu-botao {
  background: #1A5CE6;
}
```

### 5. Integração com Tailwind

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: 'var(--primary)',
        'primary-bg': 'var(--primary-bg)',
        surface: 'var(--surface)',
        border: 'var(--border)',
      },
      boxShadow: {
        acc: 'var(--shadow-acc)',
        sm:  'var(--shadow-sm)',
        md:  'var(--shadow-md)',
      },
    },
  },
}
```

---

## Estrutura de arquivos

```
design-system/
├── design.css      ← tokens, temas e utilitários
├── design.md       ← esta documentação
└── design.html     ← referência visual interativa
```

---

## Referência rápida de temas

```css
/* Azul Claro */
[data-theme="blue-light"]   { --primary: #1A5CE6; --bg: #faf9f5; }

/* Azul Escuro */
[data-theme="blue-dark"]    { --primary: #4A76EA; --bg: #1a1815; }

/* Laranja Claro */
[data-theme="orange-light"] { --primary: #F2762E; --bg: #faf9f5; }

/* Laranja Escuro */
[data-theme="orange-dark"]  { --primary: #F48B48; --bg: #1a1815; }
```

---

*Claude Design System © 2024 — Baseado na identidade visual do Claude / Anthropic*
