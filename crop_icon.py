from PIL import Image

def crop_to_content_and_square(input_path, output_path, margin_ratio=0.05):
    img = Image.open(input_path).convert("RGBA")
    
    # Get bounding box of non-transparent content
    # For getbbox to work on alpha, we need to extract the alpha channel
    alpha = img.split()[-1]
    bbox = alpha.getbbox()
    
    if not bbox:
        print("Image is entirely transparent!")
        return
        
    print(f"Original size: {img.size}")
    print(f"Bounding box: {bbox}")
    
    # Crop to bounding box
    cropped = img.crop(bbox)
    print(f"Cropped size: {cropped.size}")
    
    # Make it a square by padding with transparent pixels
    max_dim = max(cropped.size)
    
    # Add margin
    new_dim = int(max_dim * (1 + margin_ratio * 2))
    
    square_img = Image.new("RGBA", (new_dim, new_dim), (255, 255, 255, 0))
    
    # Paste the cropped image into the center of the square
    paste_x = (new_dim - cropped.size[0]) // 2
    paste_y = (new_dim - cropped.size[1]) // 2
    
    square_img.paste(cropped, (paste_x, paste_y))
    
    square_img.save(output_path, "PNG")
    print(f"Final size: {square_img.size}")

# Run the function
crop_to_content_and_square("icons/icon-new-transparent.png", "icons/icon-new-transparent.png", margin_ratio=0.02)
