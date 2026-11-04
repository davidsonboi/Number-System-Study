# Treino Nashville

Ferramenta web para treinar o **sistema numérico de Nashville**.

## Como funciona

- Toque em **Iniciar**: um metrônomo (4/4, padrão **90 BPM**) começa a tocar. O andamento é ajustável por um slider (40–200 BPM), inclusive com o metrônomo tocando.
- Cada nota dura **4 compassos**:
  - **1º compasso**: aparece o número (grau da escala, 1–7).
  - **3º compasso**: aparece a nota correspondente no tom escolhido.
- Os graus são sorteados aleatoriamente (sem repetir o anterior), sempre dentro do tom.
- O botão **Tom** abre um pop-up lateral para trocar a tonalidade (12 tons maiores; as notas são sempre escritas com sustenido #, nunca bemol). A escolha fica salva no navegador.
- Atalho: barra de espaço inicia/para.

O clique do metrônomo diferencia o início de cada nota (mais agudo), o início de cada compasso e os demais tempos.

## Uso

Não precisa de build. Abra `index.html` no navegador, ou sirva a pasta:

```sh
python3 -m http.server 8000
```

e acesse http://localhost:8000. Funciona também no celular e pode ser publicado no GitHub Pages.
