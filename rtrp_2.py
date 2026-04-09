import cv2
import pytesseract
import numpy as np

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

image = cv2.imread(r"C:\Users\LENOVO\Pictures\Screenshots\Screenshot 2026-03-12 135328.png")

gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

# ---------- PREPROCESSING ----------
blur = cv2.GaussianBlur(gray,(5,5),0)

edges = cv2.Canny(blur,50,150)

kernel = cv2.getStructuringElement(cv2.MORPH_RECT,(12,12))
dilated = cv2.dilate(edges,kernel,iterations=2)


contours,_ = cv2.findContours(dilated,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)

components=[]

for cnt in contours:

    x,y,w,h=cv2.boundingRect(cnt)

    if w<60 or h<25:
        continue

    roi=image[y:y+h,x:x+w]

    text=pytesseract.image_to_string(roi).strip()

    avg_color=roi.mean(axis=(0,1))
    b,g,r=int(avg_color[0]),int(avg_color[1]),int(avg_color[2])

    component_type="container"

    # ---------- CLASSIFICATION ----------
    button_keywords=["sign","login","signup","submit","download"]

    if any(word in text.lower() for word in button_keywords):
        component_type="button"

    elif len(text)>80:
        component_type="paragraph"

    elif len(text)>0 and h>50:
        component_type="heading"

    elif len(text)>0:
        component_type="text"

    elif len(text)==0 and w>200 and h>200:
        component_type="image"

    components.append({
        "type":component_type,
        "text":text,
        "x":x,
        "y":y,
        "width":w,
        "height":h,
        "color_rgb":[r,g,b]
    })

# ---------- OCR TEXT BLOCKS ----------
ocr_data=pytesseract.image_to_data(gray,output_type=pytesseract.Output.DICT)

for i in range(len(ocr_data["text"])):

    text=ocr_data["text"][i].strip()

    if text=="":
        continue

    x=ocr_data["left"][i]
    y=ocr_data["top"][i]
    w=ocr_data["width"][i]
    h=ocr_data["height"][i]

    components.append({
        "type":"text",
        "text":text,
        "x":x,
        "y":y,
        "width":w,
        "height":h,
        "color_rgb":[0,0,0]
    })

# ---------- SORT COMPONENTS ----------
components=sorted(components,key=lambda c:(c["y"],c["x"]))

# ---------- TERMINAL OUTPUT ----------
print("\nDetected UI Components\n")
print("="*60)

for i,c in enumerate(components):

    print(f"\nComponent {i+1}")
    print("Type      :",c["type"])
    print("Text      :",c["text"])
    print("Position  :",c["x"],c["y"])
    print("Size      :",c["width"],"x",c["height"])
    print("Color RGB :",c["color_rgb"])

print("\nTotal Components Detected:",len(components))