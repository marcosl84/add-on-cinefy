#!/bin/bash

echo "========================================"
echo "Cinefy Add-on - Deploy Helper"
echo "========================================"
echo ""
echo "1) Render"
echo "2) Railway"
echo "3) Fly.io"
echo "4) Local"
echo ""
read -p "Escolha a opção: " choice

case $choice in
  1)
    echo "Abrindo Render..."
    echo "https://render.com"
    ;;
  2)
    echo "Abrindo Railway..."
    echo "https://railway.app"
    ;;
  3)
    echo "Abrindo Fly.io..."
    echo "https://fly.io"
    ;;
  4)
    echo "Iniciando localmente..."
    if [ ! -d "node_modules" ]; then npm install; fi
    npm run dev
    ;;
  *)
    echo "Opção inválida"
    exit 1
    ;;
esac
