# Treino Nashville

Ferramenta web para treinar o **sistema numérico de Nashville**.

## Como funciona

- Toque em **Iniciar**: um metrônomo (4/4, padrão **90 BPM**) começa a tocar. O andamento é ajustável por um slider (40–200 BPM), inclusive com o metrônomo tocando.
- Cada nota dura **4 compassos**:
  - **1º compasso**: aparece o número (grau da escala, 1–7).
  - **3º compasso**: aparece o acorde correspondente no tom escolhido.
- O número é sempre só o grau (sem "m"), mas o acorde segue o campo harmônico maior: 2, 3, 6 e 7 são menores. Ex.: em C, 2 = Dm, 3 = Em, 6 = Am, 7 = Bm.
- Os graus são sorteados aleatoriamente (sem repetir o anterior), sempre dentro do tom.
- O botão **Tom** abre um pop-up lateral para trocar a tonalidade (12 tons maiores, com a grafia usual de cada escala: F usa B♭, D usa F#, etc.). A escolha fica salva no navegador.
- Atalho: barra de espaço inicia/para.

O clique do metrônomo diferencia o início de cada nota (mais agudo), o início de cada compasso e os demais tempos.

## Uso

Não precisa de build. Abra `index.html` no navegador, ou sirva a pasta:

```sh
python3 -m http.server 8000
```

e acesse http://localhost:8000. Funciona também no celular e pode ser publicado no GitHub Pages.
