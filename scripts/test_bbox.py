from PIL import Image

import os
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
img = Image.open(os.path.join(PROJECT_ROOT, "icons/icon-new-transparent.png")).convert("RGBA")
# Get alpha channel
alpha = img.split()[-1]

# Find bounding box where alpha > 10
bbox = alpha.point(lambda p: p > 10 and 255).getbbox()
print(f"Strict bounding box: {bbox}")
print(f"Current image size: {img.size}")
