#!/data/data/com.termux/files/usr/bin/bash
set -e

REPO="asuraayz-sudo/Lighter-Hub"

cd ~/Lighter-Hub

echo "🔄 Commitando mudanças..."
git add .

if git diff --cached --quiet; then
  git commit --allow-empty -m "trigger build $(date +%H:%M:%S)"
else
  git commit -m "auto build $(date +%H:%M:%S)"
fi

echo "🔄 Pull..."
git pull --rebase origin main

echo "🚀 Push..."
git push origin main

echo "⏳ Esperando GitHub registrar workflow..."
sleep 15

echo "🔎 Buscando RUN mais recente..."

RUN_ID=$(curl -s "https://api.github.com/repos/$REPO/actions/runs?per_page=1" \
| grep '"id":' | head -1 | grep -o '[0-9]\+')

if [ -z "$RUN_ID" ]; then
  echo "❌ Não achei run"
  exit 1
fi

echo "RUN_ID: $RUN_ID"
echo "🕒 Aguardando build..."

while true; do
JSON=$(curl -s https://api.github.com/repos/$REPO/actions/runs/$RUN_ID)

STATUS=$(echo "$JSON" | sed -n 's/.*"status": *"\([^"]*\)".*/\1/p' | head -1)
CONCLUSION=$(echo "$JSON" | sed -n 's/.*"conclusion": *"\([^"]*\)".*/\1/p' | head -1)

echo "Status: $STATUS"

if [ "$STATUS" = "completed" ]; then
  echo "Resultado: $CONCLUSION"
  break
fi

sleep 10
done

if [ "$CONCLUSION" != "success" ]; then
  echo "❌ Build falhou"
  exit 1
fi

echo "📦 Baixando APK..."

ART_URL=$(curl -s https://api.github.com/repos/$REPO/actions/runs/$RUN_ID/artifacts \
| sed -n 's/.*"archive_download_url": *"\([^"]*\)".*/\1/p' | head -1)

if [ -z "$ART_URL" ]; then
  echo "❌ Artifact não encontrado"
  exit 1
fi

curl -L "$ART_URL" -o build.zip

echo "📂 Extraindo..."
unzip -o build.zip > /dev/null

APK=$(find . -name "*.apk" | head -1)

if [ -f "$APK" ]; then
  echo "📱 Abrindo APK..."
  termux-open "$APK"
else
  echo "❌ APK não encontrado"
fi
