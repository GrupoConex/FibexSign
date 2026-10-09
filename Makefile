build:
	@echo "Building with HOST_URL=${HOST_URL}"
	sed 's/^SMTP_HOST=.*/SMTP_HOST=mailhog/' .env.local_dev > .env
	cd apps/OpenSign && cp ../../.env.local_dev .env && npm install && npm run build
	HOST_URL=${HOST_URL} docker compose --profile dev up --build --force-recreate

run:
	@echo "Building with HOST_URL=${HOST_URL}"
	sed 's/^SMTP_HOST=.*/SMTP_HOST=mailhog/' .env.local_dev > .env
	docker compose --profile dev up -d
