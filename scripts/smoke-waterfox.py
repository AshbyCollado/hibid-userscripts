import json
import os
import shutil
import tempfile
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
PACKAGE = ROOT / "dist" / "flippah-waterfox-v0.2.0.zip"
UUID = "945c9f33-95cf-4cf5-a697-8565095cf559"
ARTIFACTS.mkdir(exist_ok=True)

profile_dir = tempfile.mkdtemp(prefix="flippah-waterfox-")
options = Options()
options.binary_location = r"C:\Program Files\Waterfox\waterfox.exe"
options.add_argument("-no-remote")
options.add_argument("-profile")
options.add_argument(profile_dir)
options.set_preference("extensions.webextensions.uuids", json.dumps({"flippah@alos.dev": UUID}))
options.set_preference("browser.shell.checkDefaultBrowser", False)

driver = webdriver.Firefox(options=options)
driver.set_window_size(1440, 900)
try:
    addon_id = driver.install_addon(str(PACKAGE), temporary=True)
    print(json.dumps({"stage": "installed", "addonId": addon_id, "browserVersion": driver.capabilities.get("browserVersion")}))
    driver.get(f"moz-extension://{UUID}/popup/index.html")
    WebDriverWait(driver, 20).until(lambda d: "Flippah" in d.page_source)
    host_access = driver.execute_async_script("const done=arguments[0]; chrome.permissions.contains({origins:['https://hibid.com/*','https://*.hibid.com/*']}, done);")
    print(json.dumps({"stage": "popup-runtime", "title": driver.title, "url": driver.current_url, "hostAccess": host_access}))
    driver.get("https://hibid.com/lot/311206926/mahlk-nig-ek43-coffee-grinder")
    try:
        WebDriverWait(driver, 45).until(lambda d: d.execute_script("return [...document.querySelectorAll('*')].some(e => e.shadowRoot && e.shadowRoot.textContent.includes('Flippah'))"))
    except Exception:
        driver.save_screenshot(str(ARTIFACTS / "waterfox-lot-panel-failure.png"))
        print(json.dumps({"stage": "lot-panel-failure", "title": driver.title, "url": driver.current_url, "contentVersion": driver.execute_script("return document.documentElement.dataset.flippahContentVersion || null"), "rootPresent": driver.execute_script("return Boolean(document.querySelector('#lotlens-root'))"), "body": driver.find_element(By.TAG_NAME, "body").text[:1000]}))
        driver.get("about:debugging#/runtime/this-firefox")
        time.sleep(3)
        driver.save_screenshot(str(ARTIFACTS / "waterfox-about-debugging.png"))
        print(json.dumps({"stage": "about-debugging", "body": driver.find_element(By.TAG_NAME, "body").text[:5000]}))
        raise
    driver.save_screenshot(str(ARTIFACTS / "waterfox-lot-panel.png"))

    driver.get("https://hibid.com/catalog/765226/mid-summer-deals-overstock---liquidation---returns-w31")
    WebDriverWait(driver, 45).until(lambda d: d.execute_script("return document.readyState === 'complete'"))
    driver.switch_to.new_window("tab")
    driver.get(f"moz-extension://{UUID}/popup/index.html")
    WebDriverWait(driver, 20).until(lambda d: d.find_element(By.ID, "copy-json"))
    driver.save_screenshot(str(ARTIFACTS / "waterfox-popup-before.png"))
    driver.find_element(By.ID, "copy-json").click()
    driver.close()
    driver.switch_to.window(driver.window_handles[0])
    time.sleep(1)
    driver.switch_to.new_window("tab")
    driver.get(f"moz-extension://{UUID}/popup/index.html")
    WebDriverWait(driver, 120).until(lambda d: "Ready to copy" in d.page_source or "Copied" in d.page_source)
    driver.find_element(By.ID, "copy-json").click()
    WebDriverWait(driver, 20).until(lambda d: "Copied" in d.page_source)
    clipboard = driver.execute_async_script("const done=arguments[0]; navigator.clipboard.readText().then(done, e=>done('ERROR:'+e.message));")
    if str(clipboard).startswith("ERROR:"):
        raise RuntimeError(clipboard)
    payload = json.loads(clipboard)
    items = payload["items"]
    if not payload["audit"]["complete"] or len(items) != payload["audit"]["expectedCount"]:
        raise RuntimeError("Waterfox copied payload failed exact coverage")
    if len({str(item["eventItemId"]) for item in items}) != len(items):
        raise RuntimeError("Waterfox copied payload contains duplicate IDs")
    probes = [items[0], items[len(items) // 2], items[-1]] if items else []
    if any(not item.get("description") or not item.get("images") for item in probes):
        raise RuntimeError("Waterfox copied payload is missing rich probe fields")
    driver.save_screenshot(str(ARTIFACTS / "waterfox-popup-complete.png"))
    print(json.dumps({"browser": "Waterfox", "version": driver.capabilities.get("browserVersion"), "count": len(items), "exact": True, "popupReconnected": True}))
finally:
    driver.quit()
    shutil.rmtree(profile_dir, ignore_errors=True)
