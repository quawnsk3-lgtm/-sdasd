# Veo Studio — chạy dưới dạng website công cộng
FROM node:24-slim

# ffmpeg để ghép clip
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev

COPY . .
# Không mang key theo image; key sẽ nạp qua biến môi trường của host
RUN rm -f .env && mkdir -p output

# Hugging Face Spaces yêu cầu cổng 7860; host khác có thể đổi qua ENV PORT
ENV PORT=7860
ENV HOST=0.0.0.0
EXPOSE 7860

CMD ["node", "server.js"]
