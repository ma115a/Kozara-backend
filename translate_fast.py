import json
import urllib.request
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed


def translate(text, target_lang="it"):
    if not isinstance(text, str) or not text.strip():
        return text
    # Skip translating our special placeholders
    if text.startswith("{{") and text.endswith("}}"):
        return text

    url = (
        f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl={target_lang}&dt=t&q="
        + urllib.parse.quote(text)
    )

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode())
            translated_text = "".join([sentence[0] for sentence in result[0]])
            return translated_text
    except Exception as e:
        print(f"Failed to translate: '{text[:30]}...' -> {e}")
        return text


def main():
    target_lang = "bs"  # Change this to your desired language code (e.g., 'it' for Italian, 'sr' for Serbian)

    print(f"Reading locales/en.json...")
    with open("locales/en.json", "r", encoding="utf-8") as f:
        en_data = json.load(f)

    # 1. Flatten JSON to collect all strings
    jobs = []

    def traverse_and_collect(d, parent_obj, key):
        if isinstance(d, dict):
            for k, v in d.items():
                traverse_and_collect(v, d, k)
        elif isinstance(d, list):
            for i, item in enumerate(d):
                traverse_and_collect(item, d, i)
        elif isinstance(d, str):
            jobs.append({"parent": parent_obj, "key": key, "text": d})

    # Deep copy the english dictionary
    out_data = json.loads(json.dumps(en_data))
    traverse_and_collect(out_data, None, None)

    print(f"Found {len(jobs)} strings to translate. Translating to '{target_lang}'...")

    # 2. Translate concurrently to make it extremely fast
    completed = 0
    with ThreadPoolExecutor(max_workers=20) as executor:
        future_to_job = {
            executor.submit(translate, job["text"], target_lang): job for job in jobs
        }

        for future in as_completed(future_to_job):
            job = future_to_job[future]
            try:
                translated_text = future.result()
                job["parent"][job["key"]] = translated_text
            except Exception as exc:
                print(f"Error occurred: {exc}")

            completed += 1
            if completed % 50 == 0 or completed == len(jobs):
                print(f"Progress: {completed} / {len(jobs)}")

    # 3. Save the new JSON file
    out_path = f"locales/{target_lang}.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out_data, f, indent=4, ensure_ascii=False)

    print(f"Done! Saved to {out_path}")


if __name__ == "__main__":
    main()
