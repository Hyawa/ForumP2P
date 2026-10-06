# Tutorial: PeerForum anônimo com a rede Tor

Este tutorial ensina, passo a passo, como usar o PeerForum **100% anônimo**,
roteando todo o tráfego pela rede **Tor** — para que nenhum membro (e nem o seu
provedor) descubra o seu IP.

Não precisa entender de programação. É só seguir na ordem.

> **Resumo:** você instala o Tor no seu aparelho, deixa o Tor ligado, e depois
> liga o **Modo anônimo (Tor)** dentro do PeerForum (aba **Configurações**). Em
> seguida cria ou entra numa network e convida os amigos.

---

## Índice

1. [O que o Tor garante (e o que não garante)](#1-o-que-o-tor-garante-e-o-que-não-garante)
2. [Visão geral](#2-visão-geral)
3. [PC — Windows](#3-pc--windows)
4. [PC — Linux](#4-pc--linux)
5. [PC — macOS](#5-pc--macos)
6. [Ligar o Tor no PeerForum (PC)](#6-ligar-o-tor-no-peerforum-pc)
7. [Celular — Android](#7-celular--android)
8. [Celular — iOS](#8-celular--ios)
9. [Criar/entrar numa network e convidar](#9-criarentrar-numa-network-e-convidar)
10. [Checklist: confirmar que você está anônimo](#10-checklist-confirmar-que-você-está-anônimo)
11. [Solução de problemas](#11-solução-de-problemas)
12. [Limites honestos](#12-limites-honestos)

---

## 1. O que o Tor garante (e o que não garante)

**O Tor esconde o seu IP.** Com o modo Tor ligado, os outros membros só veem um
endereço `.onion`, nunca o seu IP real; e o seu provedor (ISP) só vê tráfego
Tor, não vê com quem você fala.

**O Tor NÃO é anonimato mágico de 100%.** Ele não resolve:

- Correlação de tempo/tráfego por um adversário global (que observa as duas
  pontas ao mesmo tempo).
- O fato de que todos os seus posts usam a **mesma chave de autor** (são
  ligáveis entre si). Subchaves por rede estão no roadmap.
- Metadados de horário dos posts.

Mesmo assim, para o objetivo do PeerForum (ninguém saber **quem é quem** e
**de onde**), o Tor resolve o essencial: **o seu IP fica escondido**.

---

## 2. Visão geral

São **duas partes**:

1. **Instalar e rodar o Tor** no seu aparelho (com um "serviço onion" para você
   poder ser encontrado por quem te convidar).
2. **Ligar o modo Tor dentro do PeerForum** (aba **Configurações**) apontando
   para o Tor e colando o seu endereço `.onion`.

> Importante: o **Tor Browser** (o navegador) **não serve** para isso — ele é só
> um navegador. Você precisa do **daemon do Tor** (o programa que roda em segundo
> plano e fornece o proxy SOCKS). No Android, o daemon vem dentro do **Orbot**.

---

## 3. PC — Windows

### 3.1 Baixar o Tor (Expert Bundle)

1. Acesse <https://www.torproject.org/download/tor/>.
2. Baixe o **Windows Expert Bundle** (arquivo `.zip`).
3. Extraia o `.zip` para uma pasta fácil, por exemplo `C:\tor`.

Dentro dela você verá algo como:

```
C:\tor\tor\tor.exe
C:\tor\Data\Tor\torrc
```

### 3.2 Criar o arquivo de configuração (`torrc`)

1. Crie uma pasta para o seu serviço onion, por exemplo `C:\tor\hs-pforum`.
2. Edite (ou crie) `C:\tor\Data\Tor\torrc` e coloque isto:

```
SocksPort 9050

HiddenServiceDir C:\tor\hs-pforum
HiddenServicePort 80 127.0.0.1:4001
```

> `HiddenServicePort 80 127.0.0.1:4001` significa: "o mundo acessa a porta 80 do
> meu onion e o Tor encaminha para a porta 4001 da minha máquina" — que é onde o
> PeerForum escuta no modo Tor.

### 3.3 Iniciar o Tor

Abra o **Prompt de Comando** na pasta e rode:

```
cd C:\tor\tor
tor.exe -f C:\tor\Data\Tor\torrc
```

Deixe essa janela aberta (o Tor precisa ficar rodando). Na primeira vez ele cria
o arquivo `C:\tor\hs-pforum\hostname`.

### 3.4 Ler o seu endereço `.onion`

Abra o arquivo `C:\tor\hs-pforum\hostname` no Bloco de Notas. Vai ter algo assim:

```
exemplo1234567890abcdefghijklmnopqrstuvwxyz234567.onion
```

Copie esse endereço — você vai colar no PeerForum (passo 6).

---

## 4. PC — Linux

### 4.1 Instalar o Tor

```bash
sudo apt update
sudo apt install tor
```

(Em Fedora: `sudo dnf install tor`. Em Arch: `sudo pacman -S tor`.)

### 4.2 Configurar

```bash
sudo mkdir -p /var/lib/tor/pforum
sudo nano /etc/tor/torrc
```

Adicione as linhas:

```
SocksPort 9050

HiddenServiceDir /var/lib/tor/pforum
HiddenServicePort 80 127.0.0.1:4001
```

Reinicie o Tor:

```bash
sudo systemctl restart tor
```

### 4.3 Ler o seu endereço `.onion`

```bash
sudo cat /var/lib/tor/pforum/hostname
```

Copie o endereço `.onion` exibido (você vai colar no PeerForum, passo 6).

---

## 5. PC — macOS

### 5.1 Instalar o Tor

```bash
brew install tor
```

### 5.2 Configurar

Descubra onde está o `torrc`:

- Apple Silicon (M1/M2/M3): `/opt/homebrew/etc/tor/torrc`
- Intel: `/usr/local/etc/tor/torrc`

Edite o arquivo (troque o caminho conforme o seu caso) e adicione:

```
SocksPort 9050

HiddenServiceDir /Users/SEU_USUARIO/tor-pforum
HiddenServicePort 80 127.0.0.1:4001
```

> Use uma pasta dentro da sua home para evitar problemas de permissão. Crie a
> pasta antes: `mkdir -p ~/tor-pforum`.

Inicie o Tor:

```bash
brew services start tor
```

### 5.3 Ler o seu endereço `.onion`

```bash
cat ~/tor-pforum/hostname
```

Copie o endereço `.onion` (você vai colar no PeerForum, passo 6).

---

## 6. Ligar o Tor no PeerForum (PC)

Com o Tor rodando (janela/serviço ativo) e com o endereço `.onion` em mãos:

1. Abra o **PeerForum** (app de desktop).
2. Clique na aba **Configurações**.
3. Marque **"Modo anônimo (Tor)"**.
4. Preencha:
   - **SOCKS host:** `127.0.0.1`
   - **SOCKS porta:** `9050`
   - **Seu endereço .onion:** cole o endereço do passo anterior (ex.:
     `exemplo…xyz.onion`)
   - **Porta do onion:** `80`
5. Clique em **Salvar**. O nó reinicia sozinho com o modo Tor ligado.
6. O aviso amarelo *"Modo sem Tor…"* deve **sumir**. Isso significa que o modo
   anônimo está ativo.

Pronto: a partir daqui o seu IP não é mais exposto.

> Se você **não** colocar um endereço `.onion`, o PeerForum ainda **disca** pela
> rede Tor (você navega e lê), mas **não pode ser convidado**, porque ninguém
> consegue te alcançar. Para participar de redes como membro, informe o `.onion`.

---

## 7. Celular — Android

No Android, o Tor é fornecido pelo **Orbot**.

### 7.1 Instalar o Orbot

- **Google Play:** procure por **Orbot** (Guardian Project).
- **F-Droid:** <https://f-droid.org/packages/org.torproject.android/>

### 7.2 Ligar o Tor no Orbot

1. Abra o **Orbot** e toque em **Iniciar / Start** (o botão grande).
2. Espere ficar **"Conectado"** (Connected).

O Orbot fornece um proxy **SOCKS5 em `127.0.0.1:9050`**.

### 7.3 Criar um serviço onion no Orbot (para receber convites)

No Orbot, abra a aba/menu de **Serviços Onion** (Onion Services) e:

1. Adicione um novo serviço onion.
2. Configure o encaminhamento (porta) para: **`127.0.0.1:4001`**.
3. Toque em iniciar. O Orbot vai mostrar o **endereço `.onion`** gerado.

Copie esse endereço `.onion`.

### 7.4 Ligar o modo Tor no PeerForum (Android)

1. Abra o **PeerForum**.
2. Aba **Configurações** → marque **"Modo anônimo (Tor)"**.
3. Preencha:
   - **SOCKS host:** `127.0.0.1`
   - **SOCKS porta:** `9050`
   - **Seu endereço .onion:** cole o endereço do Orbot
   - **Porta do onion:** `80` (ou a porta que você configurou no Orbot)
4. **Salvar**. O aviso amarelo deve sumir.

> Mantenha o **Orbot conectado** enquanto usa o PeerForum.

---

## 8. Celular — iOS

**Ainda não é possível deixar o PeerForum anônimo no iPhone.**

Motivo técnico (e honesto):

- A Apple **não** permite que um app use o proxy SOCKS de outro app.
- **Não existe Orbot para iOS**, e o **Tor Browser não existe para iOS** (só o
  **Onion Browser**, que é um navegador e não expõe o Tor para outros apps).

Para o PeerForum ficar anônimo no iPhone, é preciso **embutir o Tor (Arti)
dentro do próprio app** — isso está no roadmap.

**Enquanto isso:** use o PeerForum anônimo no **PC** (seções 3–6) ou no
**Android** (seção 7).

---

## 9. Criar/entrar numa network e convidar

Agora que o modo Tor está ligado (banner amarelo sumiu):

### Se você vai **criar** a comunidade

1. Aba **Networks** → **Create a network** → dê um nome.
2. Abra a network criada → **Generate code**.
3. Compartilhe o **código** (`PFPJOIN1.…`) ou o **QR code** com quem você quer
   convidar.
4. Quem receber cola o código (ou lê o QR) e entra.

### Se você vai **entrar** numa comunidade

1. Aba **Networks** → cole o código no campo **"Join with a code"** → **Join**.
2. Pronto: você passa a falar com todos os membros daquela network.

> **Importante no modo Tor:** quem convida precisa ter informado o `.onion` (passo
> 6 / 7.4), porque é assim que o convidado encontra o convidante. Sem onion, o
> convite não conecta.

---

## 10. Checklist: confirmar que você está anônimo

- [ ] O **Tor está rodando** (daemon no PC / Orbot no Android).
- [ ] No PeerForum, o **Modo anônimo (Tor)** está **marcado** na aba
      **Configurações**.
- [ ] O aviso amarelo *"Modo sem Tor…"* **não aparece**.
- [ ] Você informou o seu **endereço `.onion`** (para poder ser convidado).
- [ ] A aba **Peers não existe** — o PeerForum não mostra endereços de ninguém
      (por design, para não vazar IP).

Se todos os itens estão marcados, seu IP está escondido dos outros membros.

---

## 11. Solução de problemas

| Problema | Causa provável | Solução |
| --- | --- | --- |
| O aviso amarelo não some | Tor desligado ou porta SOCKS errada | Confirme que o Tor/Orbot está conectado e que a porta é `9050`. |
| Não consigo receber convites | Sem endereço `.onion` informado | Informe o `.onion` (passos 6 / 7.4). |
| "Não foi possível falar com o nó local" | O nó ainda está reiniciando | Espere alguns segundos e tente de novo. |
| Orbot não mostra serviço onion | Versão antiga do Orbot | Atualize o Orbot pela Play Store/F-Droid. |
| No PC, o `.onion` não foi criado | Tor não rodou o suficiente | Deixe o Tor rodando e verifique se o `torrc` está correto. |
| Windows: "tor.exe não é reconhecido" | Rodou fora da pasta | Use `cd C:\tor\tor` antes de executar `tor.exe`. |

---

## 12. Limites honestos

- O PeerForum **não é 100% anônimo** — o Tor esconde o IP, mas correlação de
  tempo/topologia e a chave de autor estável continuam sendo pontos em aberto
  (roadmap: subchaves por rede e keystore cifrado).
- **iOS ainda não suporta** o modo anônimo (seção 8).
- O Tor deixa a navegação **mais lenta** — é o preço do anonimato.

Ficou com dúvida? Volte ao passo correspondente. Este é o caminho completo para
usar o PeerForum de forma anônima e descentralizada.
