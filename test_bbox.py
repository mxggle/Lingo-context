from PIL import Image

img = Image.open("icons/icon-new-transparent.png").convert("RGBA")
# Get alpha channel
alpha = img.split()[-1]

# Find bounding box where alpha > 10
bbox = alpha.point(lambda p: p > 10 and 255).getbbox()
print(f"Strict bounding box: {bbox}")
print(f"Current image size: {img.size}")
