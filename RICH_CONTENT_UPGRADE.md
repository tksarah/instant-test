# Rich Question Content Upgrade

This release adds rich question content, image uploads, and server-side HTML sanitization.

## Production Upgrade

- Rebuild or pull a newly built app image because `multer` and `sanitize-html` were added.
- Run `./backup.sh` before deployment.
- Create the host upload directory before first deployment: `mkdir -p uploads`.
- `docker-compose.yml` mounts `./uploads:/app/uploads`; include this directory in backups.
- Deploy with `docker compose pull app` or `docker compose build --no-cache app`, then `docker compose up -d app`.
- Verify with `docker compose logs -f app --since 1m` and `/api/health`.
- Smoke test by creating a question with a code block, link, and uploaded image, then checking both editor preview and the student exam page.
- Rollback can use the old image. The DB columns are additive, but rich questions should not be edited in the old UI after rollback.
