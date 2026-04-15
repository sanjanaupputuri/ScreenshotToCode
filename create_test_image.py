#!/usr/bin/env python3
import cv2
import numpy as np

# Create a simple UI mockup
img = np.ones((600, 800, 3), dtype=np.uint8) * 255

# Header
cv2.rectangle(img, (50, 50), (750, 120), (59, 130, 246), -1)
cv2.putText(img, "Welcome to Our App", (200, 95), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (255, 255, 255), 2)

# Button
cv2.rectangle(img, (300, 200), (500, 260), (59, 130, 246), -1)
cv2.putText(img, "Get Started", (320, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

# Input field
cv2.rectangle(img, (200, 320), (600, 370), (200, 200, 200), 2)
cv2.putText(img, "Enter your email", (220, 350), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (150, 150, 150), 1)

# Card
cv2.rectangle(img, (100, 420), (350, 550), (243, 244, 246), -1)
cv2.rectangle(img, (100, 420), (350, 550), (200, 200, 200), 2)
cv2.putText(img, "Feature Card", (130, 470), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2)
cv2.putText(img, "Description text", (130, 510), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (100, 100, 100), 1)

cv2.imwrite("backend/uploads/test_ui.png", img)
print("Test image created: backend/uploads/test_ui.png")
