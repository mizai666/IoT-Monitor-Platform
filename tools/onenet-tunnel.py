#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OneNet 推送隧道工具
把本地 3000 端口暴露到公网，生成 OneNet 推送地址

用法:
    python onenet-tunnel.py

第一次使用需要 ngrok 的 authtoken:
    https://dashboard.ngrok.com/get-started/your-authtoken
    注册后复制 token，运行:
    python onenet-tunnel.py --token YOUR_TOKEN

不需要 token 也可以临时使用（2小时限制）
"""

import sys
import time

def main():
    try:
        from pyngrok import ngrok, conf
    except ImportError:
        print("请先安装: pip install pyngrok")
        sys.exit(1)

    # 检查 authtoken
    token = None
    if '--token' in sys.argv:
        idx = sys.argv.index('--token')
        token = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else None

    if token:
        conf.get_default().auth_token = token
        print(f"[OK] authtoken 已设置")

    print("[*] 启动 ngrok 隧道 -> localhost:3000 ...")

    try:
        tunnel = ngrok.connect(3000, "http")
        public_url = tunnel.public_url
        push_url = f"{public_url}/api/onenet/receive"

        print()
        print("=" * 60)
        print("  OneNet 推送地址（复制到 OneNet 控制台）:")
        print(f"  {push_url}")
        print("=" * 60)
        print()
        print("  按 Ctrl+C 停止隧道")
        print()

        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[*] 隧道已关闭")
        ngrok.disconnect(tunnel.public_url)
    except Exception as e:
        print(f"\n[!] 失败: {e}")
        print("  可能需要 authtoken，免费注册: https://dashboard.ngrok.com")
        print("  然后: python onenet-tunnel.py --token YOUR_TOKEN")

if __name__ == '__main__':
    main()
