#!/data/data/com.termux/files/usr/bin/bash
set -e

echo "📂 Indo para o repo..."
cd ~/Lighter-Hub

echo "🔄 Preparando mudanças..."
git add .

if git diff --cached --quiet; then
  echo "✔️ Nada novo pra commit — criando commit vazio pra disparar build"
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

REPO="asuraayz-sudo/Lighter-Hub"

echo "🔎 Pegando último run..."

RUN_ID=$(curl -s https://api.github.com/repos/$REPO/actions/runs \
| grep '"id":' | head -1 | grep -o '[0-9]\+')

echo "🕒 Esperando build terminar..."

while true; do
STATUS=$(curl -s https://api.github.com/repos/$REPO/actions/runs/$RUN_ID \
| grep '"status"' | head -1)

echo "Status: $STATUS"

echo $STATUS | grep -q completed && break
sleep 15
done

echo "📦 Baixando artifact..."

ART_URL=$(curl -s https://api.github.com/repos/$REPO/actions/runs/$RUN_ID/artifacts \
| grep archive_download_url | head -1 | cut -d '"' -f4)

curl -L $ART_URL -o build.zip

echo "📂 Extraindo APK..."
unzip -o build.zip

APK=$(find . -name "*.apk" | head -1)

if [ -f "$APK" ]; then
  echo "📱 Abrindo APK..."
  termux-open "$APK"
else
  echo "❌ APK não encontrado"
fi
