# 画像を並べたコンタクトシートを作る: -- out.png w h file1 file2 ...
import bpy, sys, numpy as np, os
a = sys.argv[sys.argv.index('--')+1:]
out, cw, ch = a[0], int(a[1]), int(a[2]); files = a[3:]
cols = min(4, len(files)); rows = (len(files)+cols-1)//cols
sheet = np.ones((rows*ch, cols*cw, 4), dtype=np.float32)*0.2
for i,f in enumerate(files):
    im = bpy.data.images.load(f)
    w,h = im.size
    px = np.array(im.pixels[:], dtype=np.float32).reshape(h,w,4)
    ys = (np.arange(ch)*h/ch).astype(int); xs=(np.arange(cw)*w/cw).astype(int)
    r,c = divmod(i, cols)
    sheet[(rows-1-r)*ch:(rows-r)*ch, c*cw:(c+1)*cw] = px[ys][:,xs]
img = bpy.data.images.new('sheet', cols*cw, rows*ch)
img.pixels.foreach_set(sheet.ravel()); img.filepath_raw=out; img.file_format='PNG'; img.save()
