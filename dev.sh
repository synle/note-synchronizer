chokidar --initial --throttle "1000" --debounce "1000" \
  "src/**/**/**/**/*" \
  -c "npm run build && npm run format"
