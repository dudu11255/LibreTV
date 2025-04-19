# 使用指定的基础镜像，支持 amd64 和 arm64/v8 架构
FROM fabiocicerchia/nginx-lua:1.27.5-alpine3.21.3
LABEL maintainer="LibreTV Team"
LABEL description="LibreTV - 免费在线视频搜索与观看平台"

# 安装必要的工具
RUN apk add --no-cache curl

# 复制网站文件
COPY . /usr/share/nginx/html/

# 设置工作目录
WORKDIR /usr/share/nginx/html

# 复制自定义 nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 复制并设置入口点脚本权限
COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

# 暴露端口
EXPOSE 80

# 设置入口点
ENTRYPOINT ["/docker-entrypoint.sh"]

# 启动命令
CMD ["nginx", "-g", "daemon off;"]

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s CMD wget --quiet --tries=1 --spider http://localhost/ || exit 1