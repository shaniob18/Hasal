# הסל

רשימת קניות משותפת עם השוואת סל בין אושר עד (בעלי המלאכה 4), יוחננוף (סטאר סנטר) ונטו חיסכון (האורגים 13) באשדוד.

- האפליקציה: https://shaniob18.github.io/Hasal/ (אפשר להתקין למסך הבית)
- המחירים (`prices.json`) מתעדכנים כל בוקר מקובצי שקיפות המחירים של הרשתות.
- הרשימה המשותפת נשמרת ב־Firebase לפי קוד משפחתי.

## במחשב (Windows, PowerShell)

```powershell
# הורדת המחירים (רץ אוטומטית כל יום ב-07:30 אחרי install.bat)
powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Documents\GroceryCompare\get-prices.ps1"

# בניית prices.json מהקבצים שהורדו
py scripts\build_prices.py "$env:USERPROFILE\Documents\GroceryCompare\data" prices.json

# בדיקות
py -m unittest discover -s tests
node --test tests/logic.test.js
```
