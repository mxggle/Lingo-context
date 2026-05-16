from PIL import Image, ImageDraw
import sys

def remove_bg(input_path, output_path):
    try:
        img = Image.open(input_path).convert("RGBA")
        width, height = img.size
        
        # Check corner pixels to ensure they are white
        corner = img.getpixel((0, 0))
        if corner[0] < 240 or corner[1] < 240 or corner[2] < 240:
            print("Background doesn't seem white enough at (0,0).")
        
        ImageDraw.floodfill(img, (0, 0), (255, 255, 255, 0), thresh=10)
        ImageDraw.floodfill(img, (width-1, 0), (255, 255, 255, 0), thresh=10)
        ImageDraw.floodfill(img, (0, height-1), (255, 255, 255, 0), thresh=10)
        ImageDraw.floodfill(img, (width-1, height-1), (255, 255, 255, 0), thresh=10)
        
        img.save(output_path, "PNG")
        print("Success")
    except Exception as e:
        print(f"Error: {e}")

remove_bg("icons/icon-new.png", "icons/icon-new-transparent.png")
