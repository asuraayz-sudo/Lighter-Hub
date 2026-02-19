#!/data/data/com.termux/files/usr/bin/bash
set -e

REPO="asuraayz-sudo/Lighter-Hub"

echo "📂 Indo para o repo..."
cd ~/Lighter-Hub

echo "🔄 Preparando mudanças..."
git add .

if git diff --cached --quiet; then
  echo "✔️ Nada novo — criando commit vazio pra disparar CI"
  git commit --allow-empty -m "trigger build $(date +%H:%M:%S)"
else
  git commit -m "auto build $(date +%H:%M:%S)"
fi

echo "🔄 Sincronizando com GitHub..."
git pull --rebase origin main

echo "🚀 Enviando pro GitHub..."
git push origin main

echo "⏳ Esperando workflow iniciar..."
sleep 20

echo "🔎 Pegando último run..."

RUN_ID=$(curl -s https://api.github.com/repos/$REPO/actions/runs \
| grep -m1 '"id":' | grep -o '[0-9]\+')

if [ -z "$RUN_ID" ]; then
  echo "❌ Não consegui pegar RUN_ID"
  exit 1
fi

echo "🕒 Esperando build terminar..."

while true; do
RESP=$(curl -s https://api.github.com/repos/$REPO/actions/runs/$RUN_ID)

STATUS=$(echo "$RESP" | grep -o '"status": *"[^"]*"' | head -1 | cut -d '"' -f4)
CONCLUSION=$(echo "$RESP" | grep -o '"conclusion": *"[^"]*"' | head -1 | cut -d '"' -f4)

echo "Status: $STATUS"

if [ "$STATUS" = "completed" ]; then
  echo "Resultado: $CONCLUSION"
  break
fi

sleep 15
done

if [ "$CONCLUSION" != "success" ]; then
  echo "❌ Build falhou — não vou baixar APK"
  exit 1
fi

echo "📦 Baixando artifact..."

ART_URL=$(curl -s https://api.github.com/repos/$REPO/actions/runs/$RUN_ID/artifacts \
| grep archive_download_url | head -1 | cut -d '"' -f4)

if [ -z "$ART_URL" ]; then
  echo "❌ Artifact não encontrado"
  exit 1
fi

curl -L $ART_URL -o build.zip

echo "📂 Extraindo APK..."
unzip -o build.zip > /dev/null

APK=$(find . -name "*.apk" | head -1)

if [ -f "$APK" ]; then
  echo "📱 Abrindo APK..."
  termux-open "$APK"
else
  echo "❌ APK não encontrado após extrair"
fi
