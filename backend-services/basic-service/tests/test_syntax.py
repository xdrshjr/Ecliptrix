import ast
import sys

def check_syntax(filename):
    try:
        with open(filename, 'r', encoding='utf-8') as f:
            content = f.read()
        ast.parse(content)
        print("Syntax is valid!")
    except SyntaxError as e:
        print(f"Syntax Error: {e}")
        print(f"Line {e.lineno}: {e.text}")
        print(f"Error at position {e.offset}")
    except Exception as e:
        print(f"Other error: {e}")

if __name__ == "__main__":
    check_syntax("../app/services/video_composition_service.py")