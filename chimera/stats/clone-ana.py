# 用法：node chimera/stats/clone-stat.mjs 1 12 > s1.json；node chimera/stats/clone-stat.mjs 0 12 > s0.json；python3 chimera/stats/clone-ana.py（在放 s1/s0.json 的資料夾執行）
import json
A={k:json.load(open(f's{k}.json')) for k in ('1','0')}
def phases(o): a,b=o['ack'],o['bloc']; return {'P0 等待':(1,a-1),'P1 承認後12年':(a,a+12),'P2 到陣營':(a+13,b-1),'P3 陣營後':(b,150)}
def agg(runs,f='0'):
    res={}
    for o in runs:
        S=o['S'].get(f,{})
        for ph,(y0,y1) in phases(o).items():
            r=res.setdefault(ph,{})
            yrs=[S.get(str(y),{}) for y in range(y0,y1+1)]
            n=max(1,len(yrs))
            def tot(k): return sum(d.get(k,0) for d in yrs)
            for k in ['made','makeFood','keepFood','keepWater','cloneDead','popDead','starved','battles','wins','strTot','strClone','strVeh']:
                r[k]=r.get(k,0)+tot(k)
            r['clonesAvg']=r.get('clonesAvg',0)+tot('clones')/n
            r['foodAvg']=r.get('foodAvg',0)+tot('food')/n
            last=S.get(str(y1),{})
            r['popEnd']=r.get('popEnd',0)+last.get('pop',0); r['tilesEnd']=r.get('tilesEnd',0)+last.get('tiles',0)
    N=len(runs)
    for ph,r in res.items():
        print(f"  {ph}: 複製兵平均 {r['clonesAvg']/N:6.0f}｜造 {r['made']/N:5.0f} 名，花糧 {(r['makeFood']+r['keepFood'])/N:6.0f}（造 {r['makeFood']/N:5.0f}＋養 {r['keepFood']/N:5.0f}）水 {r['keepWater']/N:5.0f}｜餓散 {r['starved']/N:4.0f}｜戰死 複製兵 {r['cloneDead']/N:5.0f} 平民 {r['popDead']/N:5.0f}｜打 {r['battles']/N:4.1f} 場 勝率 {r['wins']/max(1,r['battles']):.0%}｜兵力中複製兵佔 {r['strClone']/max(1,r['strTot']):.0%} 載具 {r['strVeh']/max(1,r['strTot']):.0%}｜糧滿足 {r['foodAvg']/N:.2f}｜期末人口 {r['popEnd']/N:6.0f} 格數 {r['tilesEnd']/N:4.0f}")
for k,lab in (('1','有顧忌'),('0','沒顧忌')):
    print(f"== 總督府（{lab}，12 個種子平均）"); agg(A[k])
# divergence checkpoints
print("\n== 總督府人口：承認後第 N 年（有顧忌 / 沒顧忌）")
for d in (0,3,6,10,15,25,40,60,90):
    v=[]
    for k in ('1','0'):
        s=0
        for o in A[k]:
            y=o['ack']+d; s+=o['S'].get('0',{}).get(str(y),{}).get('pop',0)
        v.append(s/len(A[k]))
    print(f"  +{d:2d} 年：{v[0]:6.0f} / {v[1]:6.0f}")
# other classes: clone share and battles
print("\n== 其他勢力類型，承認後全期（有顧忌 / 沒顧忌）")
for c in ['radical','other','works','warlord']:
    line=[]
    for k in ('1','0'):
        made=dead=st=tot=b=w=0
        for o in A[k]:
            for f,cl in o['cls'].items():
                if cl!=c: continue
                S=o['S'][f]
                for y,d in S.items():
                    if int(y)<o['ack']: continue
                    made+=d.get('made',0);dead+=d.get('cloneDead',0);st+=d.get('strClone',0);tot+=d.get('strTot',0);b+=d.get('battles',0);w+=d.get('wins',0)
        line.append(f"造 {made/12:5.0f} 戰死 {dead/12:5.0f} 兵力佔 {st/max(1,tot):.0%} 勝率 {w/max(1,b):.0%}")
    print(f"  {c}: "+' ／ '.join(line))
