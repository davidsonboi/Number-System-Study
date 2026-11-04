# Treino Nashville

Ferramenta web para treinar o **sistema numérico de Nashville**, com metrônomo.

## Modos

- **Aleatório**: cada nota dura 4 compassos. O número aparece no 1º compasso e o acorde no 3º. Os graus são sorteados dentro do tom, sem repetir o anterior.
- **Progressões**: sorteia progressões comuns (1–5–6–4, 2–5–1, 6–4–1–5…). Primeiro os números aparecem, um por compasso; depois os acordes, um por compasso. Em **Ajustes** você escolhe quais progressões entram no sorteio.
- **Música**: cole a cifra de uma música (Chordify, Cifra Club, Ultimate Guitar…) em **Ajustes**. Linhas com letra são ignoradas e cada acorde vale um compasso. A ferramenta detecta o tom, converte os acordes para números e treina a música em linhas de até 4 acordes, na ordem. Trocar o tom transpõe a música. As músicas podem ser salvas no navegador.

O número é sempre só o grau (sem "m"); o acorde segue o campo harmônico maior: 2, 3, 6 e 7 são menores. Ex.: em C, 2 = Dm, 7 = Bm. Na cifra, acordes fora do tom aparecem como ♭7, ♭3, #4 etc., e acordes com baixo como 1/3.

## Outros recursos

- **BPM** ajustável de 40 a 200 (padrão 90), inclusive tocando.
- **Tocar o acorde**: o acorde soa no momento em que aparece (pode desligar em Ajustes).
- **Tom** com a grafia usual de cada escala (F usa B♭, D usa F#…).
- Atalho: barra de espaço inicia/para.
- Tudo (tom, BPM, modo, músicas) fica salvo no navegador.

## Usar no celular (GitHub Pages)

O app é instalável e funciona offline.

1. No GitHub, abra o repositório → **Settings** → **Pages**.
2. Em **Build and deployment**, escolha **Deploy from a branch**, selecione a branch (ex.: `main`) e a pasta **/ (root)** → **Save**.
3. Depois de 1–2 minutos o endereço aparece no topo da página (algo como `https://<usuário>.github.io/Number-System-Study/`).
4. No celular, abra o endereço e use **Adicionar à tela de início** (Safari: botão de compartilhar; Chrome: menu ⋮ → Instalar app).

Ao publicar uma mudança, aumente a versão em `sw.js` (`nns-v1` → `nns-v2`) para os aparelhos baixarem a versão nova.

## Rodar localmente

Não precisa de build:

```sh
python3 -m http.server 8000
```

e acesse http://localhost:8000.
