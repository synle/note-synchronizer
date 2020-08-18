mkdir -p redis-data
redis-cli shutdown 
redis-server ./redis.conf
