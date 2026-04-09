@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

:: ============================================================
:: PenceAI - Otomatik Kurulum Scripti (Windows)
:: Bu script, uygulamayi otomatik olarak kurar ve calistirmaya hazir hale getirir.
:: ============================================================

echo.
echo ========================================
echo    PenceAI Kurulum Scripti
echo ========================================
echo.

:: -----------------------------------------------------------
:: 1. Node.js Kontrolu
:: -----------------------------------------------------------
echo [1/7] Node.js kontrolu yapiliyor...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo HATA: Node.js bulunamadi!
    echo.
    echo Node.js, bu uygulamayi calistirmak icin gereklidir.
    echo Lutfen Node.js'i asagidaki adresten indirin:
    echo https://nodejs.org/
    echo.
    echo "LTS" (Long Term Support) versiyonunu indirin (v22 veya uzeri).
    echo.
    echo Kurulumdan sonra bu scripti tekrar calistirin.
    echo.
    pause
    exit /b 1
)

:: Node.js versiyonunu kontrol et
for /f "tokens=*" %%i in ('node -v 2^>nul') do set NODE_VERSION=%%i
echo Node.js bulundu: %NODE_VERSION%

:: Versiyon numarasini cikar (v22.0.0 -> 22)
for /f "tokens=1 delims=v." %%i in ('node -v 2^>nul') do set NODE_MAJOR=%%i
if %NODE_MAJOR% LSS 22 (
    echo.
    echo UYARI: Node.js versiyonu 22'den dusuk!
    echo Mevcut versiyon: %NODE_VERSION%
    echo Gerekli versiyon: 22 veya uzeri
    echo.
    echo Lutfen Node.js'in en son LTS versiyonunu yukleyin:
    echo https://nodejs.org/
    echo.
    set /p CONTINUE="Devam etmek istiyor musunuz? (E/H): "
    if /i not "!CONTINUE!"=="E" (
        pause
        exit /b 1
    )
)

:: -----------------------------------------------------------
:: 2. npm Kontrolu
:: -----------------------------------------------------------
echo.
echo [2/7] npm kontrolu yapiliyor...
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo HATA: npm bulunamadi!
    echo Node.js ile birlikte yuklenmis olmalidir.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm -v 2^>nul') do echo npm bulundu: %%i

:: -----------------------------------------------------------
:: 3. Ortam Dosyasi Kontrolu
:: -----------------------------------------------------------
echo.
echo [3/7] Ortam dosyasi kontrolu yapiliyor...
if not exist ".env" (
    echo .env dosyasi bulunamadi, .env.example'dan kopyalaniyor...
    copy .env.example .env >nul 2>&1
    if !errorlevel! equ 0 (
        echo .env dosyasi olusturuldu!
        echo.
        echo ONEMLI: .env dosyasini bir metin editoru ile acip
        echo API anahtarlarinizi girmeniz gerekecek.
    ) else (
        echo UYARI: .env dosyasi kopyalanamadi.
    )
) else (
    echo .env dosyasi zaten mevcut.
)

:: -----------------------------------------------------------
:: 4. Veritabani Dizini Olustur
:: -----------------------------------------------------------
echo.
echo [4/7] Veritabani dizini olusturuluyor...
if not exist "data" (
    mkdir data
    echo data dizini olusturuldu.
) else (
    echo data dizini zaten mevcut.
)

:: -----------------------------------------------------------
:: 5. Ana Proje Bagimliliklarini Yukle
:: -----------------------------------------------------------
echo.
echo [5/7] Ana proje bagimliliklari yukleniyor...
echo Bu islem internet hiziniza bagli olarak birkaç dakika surebilir.
echo.
call npm install
if %errorlevel% neq 0 (
    echo.
    echo HATA: Ana proje bagimliliklari yuklenirken hata olustu!
    echo.
    echo Cozum onerileri:
    echo 1. Internet baglantinizi kontrol edin.
    echo 2. Proxy arkasindaysaniz, npm proxy ayarlarini yapin.
    echo 3. "npm cache clean --force" komutunu calistirip tekrar deneyin.
    echo.
    pause
    exit /b 1
)
echo Ana proje bagimliliklari basariyla yuklendi!

:: -----------------------------------------------------------
:: 6. React Uygulama Bagimliliklarini Yukle
:: -----------------------------------------------------------
echo.
echo [6/7] React arayuz bagimliliklari yukleniyor...
echo.
cd src\web\react-app
call npm install
if %errorlevel% neq 0 (
    echo.
    echo UYARI: React bagimliliklari yuklenirken hata olustu.
    echo Ana proje yine de calisabilir, ancak arayuzde sorun olabilir.
) else (
    echo React bagimliliklari basariyla yuklendi!
)
cd ..\..

:: -----------------------------------------------------------
:: 7. Kurulum Tamamlandi
:: -----------------------------------------------------------
echo.
echo [7/7] Kurulum tamamlaniyor...
echo.
echo ========================================
echo    KURULUM BASARIYLA TAMAMLANDI!
echo ========================================
echo.
echo PenceAI kullanima hazir!
echo.
echo Uygulamayi baslatmak icin asagidaki komutu calistirin:
echo.
echo   npm run dev
echo.
echo Bu komut hem backend'i hem de frontend'i baslatacak.
echo Tarayicinizda http://localhost:3000 adresine gidin.
echo.
echo -------------------------------------------------------
echo ONEMLI NOTLAR:
echo -------------------------------------------------------
echo.
echo 1. API Anahtarlari:
echo    .env dosyasini acip en az bir LLM saglayicisinin
echo    API anahtarini girmeniz gerekiyor (OpenAI, Anthropic, vb.)
echo.
echo 2. Ollama (Opsiyonel - Yerel Model):
echo    Kendi bilgisayarinizda AI modeli calistirmak icin:
echo    a. https://ollama.com adresinden Ollama'yi indirin
echo    b. Bir model yukleyin: ollama pull llama3.2
echo    c. .env dosyasinda DEFAULT_LLM_PROVIDER=ollama yapin
echo.
echo 3. Guvenlik:
echo    - ALLOW_SHELL_EXECUTION=false olarak birakin
echo    - DASHBOARD_PASSWORD'i guclu bir sifre ile doldurun
echo.
echo ========================================
echo.
pause
