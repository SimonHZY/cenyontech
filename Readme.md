nodejs 命令脚本 目录
vim /etc/systemd/system/node-app.service
启动命令
sudo systemctl daemon-reload
sudo systemctl enable node-app
sudo systemctl start node-app
重启
sudo systemctl restart node-app
