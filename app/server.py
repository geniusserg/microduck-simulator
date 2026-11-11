#!/usr/bin/env python3
"""MicroDuck local server: static files + a tiny LLM proxy.

Serves the built simulator (the directory this file lives in) and exposes:

  GET  /api/config            -> { provider, hasKey, deepseekModel,
                                   localUrl, localModel, dailyTokens }
  POST /api/config            -> save provider / DeepSeek key / local URL
                                 + model (the key itself is never returned)
  POST /api/chat/completions  -> forward the OpenAI-format body to either
                                 DeepSeek or a local LLM (Ollama / LM Studio)

The DeepSeek API key is kept in a file on THIS computer (~/.microduck/
config.json, mode 0600) — never in the browser, never in the repo — so it
keeps working across browsers and reboots. The server binds to localhost
only, so nothing else on the network can reach it. DeepSeek is prepaid, so
it can never go negative or into debt.
"""

import json
import os
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = int(os.environ.get("MICRODUCK_PORT", "8765"))
ROOT = Path(__file__).resolve().parent  # serve the directory this file is in
CONFIG_PATH = Path.home() / ".microduck" / "config.json"

DEFAULT_CONFIG = {
    "provider": "deepseek",  # "deepseek" | "local"
    "deepseek_key": "",
    "deepseek_model": "deepseek-flash",
    "local_url": "http://localhost:11434",  # Ollama / LM Studio base URL
    "local_model": "qwen2.5:7b",
    "daily_tokens": 2000,
}


def load_config():
    cfg = {}
    try:
        cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    out = dict(DEFAULT_CONFIG)
    out.update(cfg or {})
    return out


def save_config(patch):
    cfg = load_config()
    cfg.update(patch or {})
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    try:
        os.chmod(CONFIG_PATH, 0o600)
    except OSError:
        pass
    return cfg


def public_config(cfg):
    return {
        "provider": cfg.get("provider", "deepseek"),
        "hasKey": bool(cfg.get("deepseek_key")),
        "deepseekModel": cfg.get("deepseek_model", "deepseek-flash"),
        "localUrl": cfg.get("local_url", "http://localhost:11434"),
        "localModel": cfg.get("local_model", ""),
        "dailyTokens": cfg.get("daily_tokens", 2000),
    }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # ── JSON helpers ────────────────────────────────────────────────────
    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n <= 0:
                return {}
            return json.loads(self.rfile.read(n))
        except Exception:
            return {}

    def _json(self, obj, status=200):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    # ── Routes ──────────────────────────────────────────────────────────
    def do_GET(self):
        if self.path.startswith("/api/config"):
            return self._json(public_config(load_config()))
        return super().do_GET()

    def do_POST(self):
        if self.path == "/api/config":
            return self._post_config()
        if self.path == "/api/chat/completions":
            return self._post_chat()
        self.send_error(404)

    def _post_config(self):
        body = self._read_json()
        cfg = load_config()
        patch = {}
        if "provider" in body and body["provider"] in ("deepseek", "local"):
            patch["provider"] = body["provider"]
        if isinstance(body.get("deepseekKey"), str) and body["deepseekKey"].strip():
            patch["deepseek_key"] = body["deepseekKey"].strip()
        if body.get("clearKey"):
            patch["deepseek_key"] = ""
        if isinstance(body.get("localUrl"), str) and body["localUrl"].strip():
            patch["local_url"] = body["localUrl"].strip()
        if isinstance(body.get("localModel"), str):
            patch["local_model"] = body["localModel"].strip()
        if isinstance(body.get("dailyTokens"), (int, float)) and body["dailyTokens"] >= 0:
            patch["daily_tokens"] = int(body["dailyTokens"])
        cfg = save_config(patch)
        return self._json(public_config(cfg))

    def _post_chat(self):
        body = self._read_json()
        cfg = load_config()
        provider = cfg.get("provider", "deepseek")

        if provider == "local":
            base = (cfg.get("local_url") or "").strip().rstrip("/")
            if not base:
                return self._json(
                    {"error": {"message": "Local model URL is not set. Open Settings and save it."}}, 400
                )
            url = base + ("/v1" if not base.endswith("/v1") else "") + "/chat/completions"
            body["model"] = cfg.get("local_model") or body.get("model")
            # Local runtimes (Ollama, LM Studio) often reject response_format;
            # the prompt + tolerant parsing on the client handle JSON anyway.
            body.pop("response_format", None)
            headers = {"Content-Type": "application/json"}
        else:
            key = cfg.get("deepseek_key")
            if not key:
                return self._json(
                    {"error": {"message": "DeepSeek API key is not set. Open Settings and save it."}}, 400
                )
            url = "https://api.deepseek.com/chat/completions"
            body["model"] = cfg.get("deepseek_model", "deepseek-flash")
            headers = {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + key,
            }

        return self._forward(url, headers, body)

    def _forward(self, url, headers, body):
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
        except urllib.error.HTTPError as e:
            payload = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except Exception as e:  # noqa: BLE001 - report any transport error to the UI
            self._json({"error": {"message": f"Could not reach the model: {e}"}}, 502)

    def log_message(self, fmt, *args):  # keep the console quiet for assets
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)


def main():
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"MicroDuck serving http://{HOST}:{PORT}  (config: {CONFIG_PATH})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
