import os
import json
import re

def parse_question_text(text):
    if not text:
        return text, ""

    # Improved regex to find ANY markdown table grid with optional "Table: xxx" above
    # Match: (Optional "Table: xxx" line) followed by multiple lines starting with | or +-
    table_block_pattern = re.compile(
        r'((?:\*?\*?Table\s*:\s*[a-zA-Z0-9_\s]+\*?\*?\s*\n+)?(?:[\|+].*?\n)+)',
        re.IGNORECASE
    )

    main_text = text
    schema_string = ""

    matches = list(table_block_pattern.finditer(text))

    for match in matches:
        raw_table_block = match.group(1)
        
        # Only consider it a table if it actually has pipe/plus markdown structures
        if '|' in raw_table_block or '+' in raw_table_block:
            # Remove the matched block completely from main text
            main_text = main_text.replace(raw_table_block, "")
            schema_string += raw_table_block.strip() + "\n\n"

    # Clean up excess newlines if it left them behind
    main_text = re.sub(r'\n{3,}', '\n\n', main_text)

    return main_text.strip(), schema_string.strip()

def process_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if 'description' not in data:
        return False

    old_desc = data['description']
    new_desc, extracted_schema = parse_question_text(old_desc)

    if extracted_schema:
        # Save as the new schema field
        data['schema'] = extracted_schema
        # Update the description without the tables
        data['description'] = new_desc

        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        
        print(f"Reprocessed: {os.path.basename(filepath)}")
        return True
    
    return False

def main():
    target_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'Questions', 'SQL_questions'))
    
    if not os.path.exists(target_dir):
        print(f"Directory not found: {target_dir}")
        return

    processed_count = 0
    for filename in os.listdir(target_dir):
        if filename.endswith(".json"):
            filepath = os.path.join(target_dir, filename)
            if process_file(filepath):
                processed_count += 1

    print(f"\nDone! Correctly re-extracted schemas from {processed_count} files.")

if __name__ == '__main__':
    main()
