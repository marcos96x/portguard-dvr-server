# portguard-dvr-server

API em Node.js para cadastrar DVRs de forma dinâmica no [go2rtc](https://github.com/AlexxIT/go2rtc) e devolver, para cada câmera, as URLs prontas que o webapp (HTML/CSS/JS) usa para exibir o vídeo.

O navegador **não toca RTSP**. Este projeto roda numa VM Linux na nuvem, puxa o RTSP de cada DVR (porta 554) e entrega WebRTC, MSE, HLS ou uma imagem JPEG para o aplicativo.

Os streams criados pela API do go2rtc ficam só na memória e somem se ele reiniciar. Por isso a API grava os DVRs em `data/dvrs.json` e recria tudo na subida e a cada intervalo.

## Arquitetura

```
Webapp (HTML/CSS/JS)
    │  assiste as URLs públicas (iframe / WebRTC / HLS / JPEG)
    ▼
go2rtc  (:1984 HTTP, :8555 WebRTC)
    ▲  a API cria/apaga streams com PUT/DELETE /api/streams
portguard-dvr-server  (:3000, header X-API-Key)
    │
    └─ data/dvrs.json  (persistência)
         │
         ▼  RTSP
    DVRs dos clientes  (DDNS:554)
```

Um único servidor atende vários DVRs. Cada câmera vira um stream com o nome `<id-do-dvr>_ch<N>`.

## Requisitos

- Linux (x86_64 ou ARM64)
- Node.js 22 ou superior
- go2rtc (o script `scripts/install-go2rtc.sh` baixa o binário oficial)
- Portas no firewall da VM:
  - **443/TCP** se houver proxy HTTPS (recomendado), **ou** 1984/TCP se o go2rtc ficar exposto direto
  - **8555/TCP e 8555/UDP** para WebRTC
  - **3000/TCP** só se a API de gestão for pública (melhor deixá-la atrás do proxy, ou só na rede privada)

## Instalação na VM

```bash
# 1. Copie o projeto (exemplo)
sudo mkdir -p /opt/portguard-dvr-server
sudo cp -a . /opt/portguard-dvr-server
cd /opt/portguard-dvr-server

# 2. Instale o go2rtc
sudo ./scripts/install-go2rtc.sh /usr/local/bin
sudo cp go2rtc.yaml /etc/go2rtc.yaml
# Edite /etc/go2rtc.yaml e troque a senha da API do go2rtc

# 3. Configure a API
cp .env.example .env
# Edite o .env: API_KEY, senhas, PUBLIC_GO2RTC_URL (o HTTPS público do go2rtc)
npm install --omit=dev

# 4. Usuário e systemd
sudo useradd --system --home /opt/portguard-dvr-server --shell /usr/sbin/nologin portguard
sudo chown -R portguard:portguard /opt/portguard-dvr-server
sudo mkdir -p /var/lib/portguard-dvr-server
sudo chown portguard:portguard /var/lib/portguard-dvr-server
sudo cp systemd/go2rtc.service /etc/systemd/system/
sudo cp systemd/portguard-dvr-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now go2rtc portguard-dvr-server

# 5. HTTPS (opcional, mas recomendado)
# Ajuste deploy/Caddyfile ou deploy/nginx.conf com o seu domínio
# e aponte PUBLIC_GO2RTC_URL para https://cameras.seu-dominio.com
```

Subida manual, sem systemd:

```bash
/usr/local/bin/go2rtc -config ./go2rtc.yaml
node src/server.js
```

### Firewall (exemplo UFW)

```bash
sudo ufw allow 22/tcp
sudo ufw allow 443/tcp
sudo ufw allow 8555/tcp
sudo ufw allow 8555/udp
# Só libere 1984 ou 3000 se não estiver usando proxy HTTPS
sudo ufw enable
```

## Uso da API

Todas as rotas `/api/*` exigem o header `X-API-Key` (o valor de `API_KEY` no arquivo `.env`). As rotas `GET /docs` (documentação HTML em português) e `GET /health` (saúde, para o load balancer) são públicas e não devolvem senhas.

Abra a documentação em `http://127.0.0.1:3000/docs`.

As senhas dos DVRs **nunca** voltam nas respostas: o campo `password` aparece como `********`. No `PUT`, se você reenviar `********`, a senha atual é mantida.

Credenciais são aplicadas com URL-encode na URL RTSP (`admin@loja` vira `admin%40loja`).

### `POST /api/dvrs` — cadastrar um DVR

O corpo aceita `channels` como quantidade (`4` gera as câmeras 1 a 4) ou como lista (`[1, 3, 5]`). O padrão de URL é Intelbras:

`rtsp://usuario:senha@host:porta/cam/realmonitor?channel=N&subtype=S`

`subtype` padrão: `1` (substream, mais leve para web/celular). Use `0` para o stream principal. Para outro fabricante, envie `rtspTemplate` com os placeholders `{username}`, `{password}`, `{host}`, `{rtspPort}`, `{channel}`, `{subtype}`.

```bash
curl -sS -X POST http://127.0.0.1:3000/api/dvrs \
  -H "Content-Type: application/json" \
  -H "X-API-Key: SUA_API_KEY" \
  -d '{
    "name": "Loja Centro",
    "host": "loja-centro.ddns-intelbras.com.br",
    "rtspPort": 554,
    "username": "visualizador",
    "password": "senha-do-dvr",
    "channels": 2,
    "subtype": 1,
    "brand": "intelbras"
  }'
```

Resposta (exemplo, `id` é gerado automaticamente):

```json
{
  "id": "loja-centro-a1b2c3",
  "name": "Loja Centro",
  "host": "loja-centro.ddns-intelbras.com.br",
  "rtspPort": 554,
  "username": "visualizador",
  "password": "********",
  "channels": [1, 2],
  "subtype": 1,
  "brand": "intelbras",
  "rtspTemplate": null,
  "createdAt": "2026-11-18T12:00:00.000Z",
  "updatedAt": "2026-11-18T12:00:00.000Z",
  "cameras": [
    {
      "channel": 1,
      "streamName": "loja-centro-a1b2c3_ch1",
      "urls": {
        "iframe": "https://cameras.seu-dominio.com/stream.html?src=loja-centro-a1b2c3_ch1",
        "webrtc": "https://cameras.seu-dominio.com/api/webrtc?src=loja-centro-a1b2c3_ch1",
        "webrtcPlayer": "https://cameras.seu-dominio.com/webrtc.html?src=loja-centro-a1b2c3_ch1",
        "mse": "wss://cameras.seu-dominio.com/api/ws?src=loja-centro-a1b2c3_ch1",
        "hls": "https://cameras.seu-dominio.com/api/stream.m3u8?src=loja-centro-a1b2c3_ch1",
        "snapshot": "https://cameras.seu-dominio.com/api/frame.jpeg?src=loja-centro-a1b2c3_ch1",
        "mjpeg": "https://cameras.seu-dominio.com/api/stream.mjpeg?src=loja-centro-a1b2c3_ch1"
      }
    }
  ],
  "go2rtc": { "synced": true, "created": 2, "failed": 0, "errors": [] }
}
```

No webapp, o caminho mais simples é:

```html
<iframe src="URL_DO_CAMPO_cameras[0].urls.iframe" allow="autoplay; fullscreen"></iframe>
```

Veja também `examples/player.html`.


### `GET /api/clip` — últimos N segundos (playback do DVR)

Devolve um MP4 (H.264) com os últimos `seconds` da câmera, lidos da gravação do DVR Intelbras via RTSP `/cam/playback`. Padrão 15 segundos (mínimo 5, máximo 30). Exige `X-API-Key`.

```bash
curl -sS -H "X-API-Key: SUA_API_KEY" \
  -o clip.mp4 \
  "http://127.0.0.1:3000/api/clip?src=loja-centro-a1b2c3_ch1&seconds=15"
```

`src` é o `streamName` ou `streamNameMain` da câmera. O intervalo usa o relógio do DVR (o header HTTP `Date` da porta 8001, interpretado em America/Sao_Paulo). A rota tenta alguns recuos (2s, 15s, 30s, 60s) se o DVR responder 4xx. Neste firmware o playback não aceita `subtype` e vem em H.265 1280×720; a API transcodifica para H.264 para o navegador. No máximo 2 clipes ao mesmo tempo (HTTP 429). Chame pelo backend, não coloque a `API_KEY` no JavaScript público.

Erros: `400` src/seconds inválidos, `404` câmera não cadastrada, `409` sem gravação na janela, `429` ocupado, `504` timeout (o transcode roda quase em tempo real; no Nginx use `proxy_read_timeout` de pelo menos 120s em `/api/clip`).

### Outras rotas

```bash
# Listar
curl -sS http://127.0.0.1:3000/api/dvrs -H "X-API-Key: SUA_API_KEY"

# Um DVR
curl -sS http://127.0.0.1:3000/api/dvrs/loja-centro-a1b2c3 -H "X-API-Key: SUA_API_KEY"

# Atualizar (recria os streams). Omita password ou envie ******** para não trocar a senha.
curl -sS -X PUT http://127.0.0.1:3000/api/dvrs/loja-centro-a1b2c3 \
  -H "Content-Type: application/json" \
  -H "X-API-Key: SUA_API_KEY" \
  -d '{"channels":[1,2,3],"subtype":1}'

# Remover o DVR e apagar os streams no go2rtc
curl -sS -X DELETE http://127.0.0.1:3000/api/dvrs/loja-centro-a1b2c3 \
  -H "X-API-Key: SUA_API_KEY"

# Recriar todos os streams salvos (útil depois de reiniciar só o go2rtc)
curl -sS -X POST http://127.0.0.1:3000/api/sync -H "X-API-Key: SUA_API_KEY"

# Clipe dos últimos 15s (MP4 H.264, gravado pelo DVR)
curl -sS -H "X-API-Key: SUA_API_KEY" -o clip.mp4 "http://127.0.0.1:3000/api/clip?src=loja-centro-a1b2c3_ch1&seconds=15"

# Documentação HTML (sem API key)
curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:3000/docs

# Saúde da API e alcance do go2rtc (sem API key)
curl -sS http://127.0.0.1:3000/health
```

## Segurança

- Crie no DVR um **usuário só de visualização**, nunca use o `admin` no app.
- No roteador de cada cliente, se a HGU permitir, libere a porta **554 só para o IP da VM**.
- Troque a senha da API do go2rtc (`go2rtc.yaml`) e a `API_KEY` desta API. Não commite o arquivo `.env`.
- Coloque o go2rtc atrás de HTTPS (Caddy ou Nginx). A API de gestão também deve ficar protegida (chave + HTTPS; de preferência não exposta na internet aberta).
- O painel web do go2rtc (`:1984`) enxerga todos os streams. Sem autenticação, qualquer pessoa que adivinhar o nome do stream (`…_ch1`) pode tentar assistir. Mantenha `username`/`password` no `go2rtc.yaml` ou deixe o `:1984` só em localhost, atrás do proxy.
- Esta API não devolve senhas, mas elas ficam em `data/dvrs.json`. Restrinja a permissão dessa pasta (`chmod 700`) e o arquivo já é gravado com modo `0600`.
- O go2rtc 1.9.x, depois de criar ou apagar um stream pela API, tenta gravar isso no `go2rtc.yaml` (incluindo a URL RTSP com senha). Deixe esse arquivo com permissão `0600`. Se preferir que ele não grave, suba o go2rtc com a config em string (`go2rtc -config '{...}'`). A fonte da verdade é o `data/dvrs.json`; a API recria os streams se o go2rtc reiniciar.

## Estrutura

```
portguard-dvr-server/
├── src/                  # API Node.js
├── data/dvrs.json        # criado em tempo de execução (não versionado)
├── go2rtc.yaml           # config base do go2rtc, sem streams fixos
├── .env.example
├── public/docs.html      # página servida em GET /docs
├── scripts/install-go2rtc.sh
├── systemd/              # unidades go2rtc + API
├── deploy/               # Nginx e Caddy com HTTPS
├── examples/player.html
└── README.md
```

## Solução de problemas

- `GET /health` com `go2rtc.reachable: false`: o go2rtc não está no ar, ou `GO2RTC_URL` está errada.
- `go2rtc.authorized: false`: usuário/senha do `.env` não batem com o `go2rtc.yaml`.
- Câmera cadastrada, mas o iframe não abre: confira o firewall (1984 ou 443, e 8555 TCP/UDP para WebRTC) e se `PUBLIC_GO2RTC_URL` é o endereço que o **navegador** alcança, não o `127.0.0.1` da VM.
- Depois de reiniciar o go2rtc, espere o intervalo de sync (`SYNC_INTERVAL_MS`, padrão 30s) ou chame `POST /api/sync`.
